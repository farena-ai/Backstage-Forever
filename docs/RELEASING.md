# Building and publishing releases

Public MIT application repository: farena-ai/Backstage-Forever. Backstage Coding, designed by Frank Arena. Version 0.8.0 Adventure Company remains a Windows-first preview. Reference data retains separate CC BY 4.0 notices. Installers are not Windows Authenticode signed; Ed25519 app-update signatures separately authenticate downloads. See UPDATES.md for trust, key management and rotation.

## Local validation

Use Node.js 24 LTS and locked dependencies:

```powershell
npm ci
npm run check:addon-reference
npm test
npm run test:ui
npm run test:integration
npm run test:living-backend
npm run test:living-setup
npm run test:company-backend
npm run test:company
npm run test:setup
npm run test:autosave
npm run test:command-center
npm run test:knowledge
npm run dist
npm run test:packaged
```

The per-user x64 NSIS installer is written to dist. User records, provider credentials, CLI homes, signing private keys and scratch files must never be included. Include LICENSE, font notices and artwork provenance. Official Claude/Grok tools are not bundled or relicensed.

The bundled `data/forever` pack, source lock, CC BY license and change notice must be present in the ASAR. Packaged acceptance checks source/data byte hashes as well as actual automatic five-file addon installation and repair in a synthetic client. The tracked `BackstageForeverReference.lua` is an offline, safely escaped compilation of the validated bundled pack; `npm run check:addon-reference` must reproduce its exact LF bytes without writing. The installer does not generate Lua from runtime public downloads. Reference inputs stay out of the shipped app and source archive. If changing the original pack or compiler, separately reproduce the full pack from the six hash-locked inputs with the command in FOREVER-DATA.md. Ordinary unit tests remain offline and use tracked fixtures. Unit files run serially to avoid competing Lua VM CPU deadlines; the test deadlines and assertions remain unchanged.

## Signed publication

Set package version and releaseChannel explicitly (preview/stable), update docs, review/test/commit, then push an exact vMAJOR.MINOR.PATCH tag. The release workflow validates version/channel, runs locked installation and tests, builds, signs with the protected repository secret, archives source and generates checksums. New releases remain drafts until all assets upload. Never put private keys on command lines, in logs or in source. Do not upload competing manual builds while that workflow owns the version’s assets.

App checks run only while open. No watcher service, scheduled task, cron, chat automation or recurring polling job is created. Tag-triggered CI produces releases only when deliberately triggered.

## Acceptance evidence

Record actual results in VALIDATION.md. Fixtures do not certify live consent, entitlements, billing or game APIs. Clean-machine install/upgrade/uninstall, real self-update, accessibility, Windows publisher signing and in-client addon tests remain separate gates until performed. Never spend provider credits just for a badge. No beta/testing store track is used by this workflow.

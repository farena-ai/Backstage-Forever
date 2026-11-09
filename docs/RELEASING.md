# Building and publishing releases

Public MIT repository: farena-ai/Backstage-Forever. Backstage Coding, designed by Frank Arena. Version 0.2.0 remains a Windows preview. Installers are not Windows Authenticode signed; Ed25519 app-update signatures separately authenticate downloads. See UPDATES.md for trust, key management and rotation.

## Local validation

Use Node.js 24 LTS and locked dependencies:

```powershell
npm ci
npm test
npm run test:ui
npm run test:integration
npm run dist
npm run test:packaged
```

The per-user x64 NSIS installer is written to dist. User records, provider credentials, CLI homes, signing private keys and scratch files must never be included. Include LICENSE, font notices and artwork provenance. Official Claude/Grok tools are not bundled or relicensed.

## Signed publication

Set package version and releaseChannel explicitly (preview/stable), update docs, review/test/commit, then push an exact vMAJOR.MINOR.PATCH tag. The release workflow validates version/channel, runs locked installation and tests, builds, signs with the protected repository secret, archives source and generates checksums. New releases remain drafts until all assets upload. Never put private keys on command lines, in logs or in source. Do not upload competing manual builds while that workflow owns the version’s assets.

App checks run only while open. No watcher service, scheduled task, cron, chat automation or recurring polling job is created. Tag-triggered CI produces releases only when deliberately triggered.

## Acceptance evidence

Record actual results in VALIDATION.md. Fixtures do not certify live consent, entitlements, billing or game APIs. Clean-machine install/upgrade/uninstall, real self-update, accessibility, Windows publisher signing and in-client addon tests remain separate gates until performed. Never spend provider credits just for a badge. No beta/testing store track is used by this workflow.

# BF 0.6 official update asset fallback

Task1b follows the reviewed retry/cleanup work. Read the binding design at `docs/superpowers/specs/2026-11-09-update-asset-fallback-v06-design.md` and the measured anonymous installed-Electron proof in `work/v06-api-route-probe.md` / `.json`. The single native run downloaded and independently rehashed all174,192,312 bytes of0.5 through the official asset API, with its pinned manifest and original signed URL still verified. The ordinary route previously exhausted HTTP504s.

## Task1b: production fallback and acceptance

Owned files: updater core, corresponding updater/reliability/network tests, runtime fixture extension if needed, updater recovery docs only. Preserve knowledge/backend/renderer work; do not change version, data, profile/provider code, signing keys or release policy.

- Test first for retryable standard-route failure followed by successful authenticated API transport, for both manifest and installer. Derive alternate URLs only from validated numeric IDs of the selected release's exact matching asset names/browser URLs. Missing or mismatched IDs must not enable arbitrary routes.
- Implement the strict fixed-repository binary API target and restricted redirects. No GitHub token/cookie/new login, TLS or OS-security bypass. Keep original signed manifest URL and all key/version/hash/size checks. No permanent verification failure may trigger a fallback bypass.
- Keep three total attempts per operation, fresh hashes/partials, mandatory cleanup-before-retry, previous-ready preservation and cancellation/epoch behavior. Retain current status fields and bounded private diagnostics. Extend targeted URL, retry-cap, malicious metadata, signature/hash/size and cleanup fixtures.
- Run covering updater/renderer checks and actual isolated Electron networking with production fallback code. Include interrupted transfer recovery if network permits; fully verify the complete public installer and cache. Do not execute installers or touch actual user/game data. Record upstream failures honestly rather than looping indefinitely.
- Update docs with the official fallback and measured boundary. Commit explicit owned files and self-review. Full report `work/v06-task1b-report.md`, including commands/output, API compatibility, files/commits and remaining concerns; return short DONE/concerns, commit and test summary. Independent spec+quality review before Quest Guide implementation proceeds. Final whole-suite/packaged/public0.6 gates remain required later.

# BF 0.6 update reliability

User reports installed BF discovers0.5.0 but fails with a generic verification/download error. Reproduce in the actual installed Electron binary using isolated temporary userData, no player profiles/keys read, no installer execution. Current implementation has one download attempt, loses failure stage/details, treats rejected newer manifests as current, and uses a case-sensitive cache realpath comparison on Windows.

## Chosen approach

Bounded fresh-download retries plus actionable diagnostics, preserving pinned Ed25519/signature/URL/SHA256/size checks. Compared with simply increasing a timeout, this handles transient resets and explains permanent failures. Compared with range-resume downloads, fresh retry is simpler and never reuses unverified partial bytes. Keep last good cache and never present failure as up-to-date.

## Requirements

- Inspect actual installed runtime/version and public release request behavior. Record only stage, stable error code, HTTP status and byte count; never tokens, signed redirect querystrings, paths, raw stack traces or player data. Provide a local diagnostic record whose fields are allowlisted and bounded.
- New request errors distinguish network/timeout/HTTP/redirect/body abort/size, without raw URLs. Abort and truncated streams reject promptly rather than hanging. Retry transient download/network/429/5xx failures at most3attempts, bounded backoff, cancellation-aware. Use cache-control for fresh redirect metadata if supported; do not bypass TLS, host allowlists or security software.
- Each download attempt uses a new partial file/hash, cleanly closes/removes its owned partial file and resets progress. Hash, size, signature and unsafe-path failures are permanent failures, not grounds to weaken verification. Publish ready.json only after a complete successful verified download and atomic file placement. Preserve any previously verified ready installer if a newer attempt fails.
- Strictly bind the candidate to signed version and repository asset. Distinguish no newer release from a newer candidate whose manifest could not be fetched/verified; do not show up-to-date on that failure. Keep status fields compatible and add bounded stable diagnostic fields; user messages identify discovery/verification/download/cache issues and a sensible retry action. No raw provider/server errors shown.
- Windows cache comparison permits benign path casing only; still reject symlinks/junction escapes and unexpected targets. Detect permission/disk errors accurately; do not request elevation or modify Windows security settings.
- Installed runtime recovery tests must exercise actual Electron networking/crypto/caching, not merely Node source mocks. Public downloads remain fully authenticated. Do not execute an installer in tests, change update preferences without consent, touch game files or replace an existing installed binary.
- GUI Updates offers a clear retry and manual Releases link fallback through the existing fixed URL allowlist. Show retry/progress and useful sanitized failure text, no technical wall. Automatic checks remain while app is open; no watcher service, scheduler, cron, recurring thread or external job.

## Acceptance

Test-first fixtures: transient reset/timeout then success, retry cap/backoff/cancellation, aborted/truncated response, invalid signature/hash/size permanent failure, stale ready preservation, newer manifest failure not current, safe Windows casing versus unsafe paths, clear diagnostic privacy bounds. Existing updater security tests and smoke flows stay green. Capture measured runtime failures without claiming a root cause until observed. Ship all fixes in0.6; since old installed clients cannot receive code until upgraded, offer a verified direct installer as bootstrap fallback rather than claiming old code has been repaired remotely.

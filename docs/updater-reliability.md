# Update recovery and diagnostics

The updater selects the newest strictly versioned eligible GitHub release first.
It does not fetch older manifests after selecting that release or silently treat
a rejected newer manifest as an up-to-date result. A previously verified cached
installer remains available if a newer check or download fails.

Discovery, manifest retrieval and installer download each allow at most three
fresh attempts for transient network, timeout, interrupted-body, HTTP 429 and
HTTP 5xx failures. Backoff is 500 ms then 1,500 ms and respects cancellation.
Every installer attempt starts with a new partial file and hash. Signature,
signed version/asset binding, SHA256, size and unsafe-path failures do not retry
or bypass verification. Failed partial files are closed and removed before
backoff. If closing or removing an owned failed partial fails, retries stop and
a sanitized cache error remains visible; an older verified installer is preserved.
An attempt never removes a colliding file it did not create.
Ready metadata is published only after complete verification and
atomic placement.

Initial requests to this repository's GitHub release-download route use a fresh
nonsecret `_bf` query value and `Cache-Control: no-cache` to refresh redirect
metadata. CDN redirect query strings remain unchanged. The original signed
manifest URL still has to equal the expected fixed repository asset URL; TLS,
redirect host restrictions and all cryptographic checks remain enabled.

On Windows, benign path casing differences are accepted. Cache creation rejects
redirected existing ancestors before creating directories and rejects unsafe
cache/file targets. A startup cache failure leaves the app usable with an update
error, without reading preferences through that redirected cache.

## Status and local record

Existing status fields and phases remain supported. New fields are:

- `readyVersion`: the verified cached installer version, separately from the
  newest discovered `availableVersion`.
- `retryAttempt`: the current operation's attempt, from 0 through 3.
- `diagnostic`: null or `{ stage, code, attempt, bytes, httpStatus? }`.

Stages are `discovery`, `manifest`, `download` and `cache`. Codes come from a fixed
allowlist. Attempt, byte and HTTP status values are bounded. The app-owned
`updates/diagnostic.json` stores only the latest failure record when the cache is
writable. It never includes URLs, signed query strings, file paths, raw exception
text, stacks, credentials or player data. Successful verified downloads clear
the failure record. Cache failures still appear in status when writing the local
record itself is impossible.

Updates shows a retry action, an allowlisted Releases fallback, retry progress
and a short stage-specific message. When a newer update fails but an older one
is cached, both versions and the failure remain visible.

## Verification

```powershell
node --test tests/updater-reliability.test.cjs tests/updater.test.cjs tests/renderer-updates.test.cjs
node scripts/updater-runtime-smoke.cjs --source --expect-ready
node scripts/updater-runtime-smoke.cjs --source --interrupt-first --expect-ready
```

The runtime fixture launches the installed Electron executable with a fresh
temporary user-data directory. Its own background installation is disabled in
that temporary directory. The fixture refuses installer execution, verifies the
complete downloaded installer and rechecks its cached bytes, then removes only
its guarded temporary directory. Without `--source`, it checks the installed
updater; with `--source`, it loads the repository updater into that same native
Electron runtime. `--interrupt-first` injects one stream interruption after
roughly one MiB; real network failures still count against the three-attempt cap.

On 2026-11-09 the installed app was 0.4.0 / Electron 45.2.3. One isolated installed
check successfully authenticated and downloaded all 174,192,312 bytes of 0.5.0.
A source recovery run also completed a fresh full download after an injected
stream interruption. Later probes observed real HTTP 504 responses for public
manifest and installer requests; fresh-query metadata retrieval succeeded during
these observations. These measurements support transient network/redirect-cache
recovery work, but do not establish the exact cause of the original user report.
No fixture executes an installer or demonstrates a completed installed upgrade.
The final non-induced live check retrieved the manifest after two HTTP 504s,
then exhausted three HTTP 504 installer attempts. Its final diagnostic was
`download / HTTP / attempt 3 / status 504 / bytes 0`; it correctly remained an
update error. The final unit suite passed 166/166 with test concurrency set to 1.

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

After a transient standard-route failure, the remaining attempts may use GitHub's
[official binary asset API](https://docs.github.com/en/rest/releases/assets#get-a-release-asset)
for that same selected release. The updater constructs
only `https://api.github.com/repos/farena-ai/Backstage-Forever/releases/assets/ID`
from a positive safe-integer ID on an asset whose exact name and browser URL
match the expected manifest or signed installer URL. Metadata-supplied API URLs
are never used. Missing, unsafe or mismatched IDs disable the alias while normal
downloads remain available. The normal route always runs first, and the alias
shares the same three total attempts; there is no second retry budget.

Binary API requests send `Accept: application/octet-stream` anonymously and
accept a direct 200 or bounded redirects to the existing approved CDN hosts.
The API-origin policy persists across every redirect: neither another API path
nor a GitHub repository URL may become a redirect target. Arbitrary repositories,
credentials, ports, query strings, fragments and encoded API paths are rejected
as initial API targets. Signed CDN query strings remain untouched. The signed
manifest's original browser URL, pinned Ed25519 key, release/tag binding, SHA256
and byte-size checks remain mandatory. Invalid verification, unsafe cache paths
and failed partial cleanup never trigger another transport route.

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
node --test tests/updater-asset-fallback.test.cjs tests/updater-reliability.test.cjs tests/updater.test.cjs tests/update-signing.test.cjs tests/renderer-updates.test.cjs
node scripts/updater-runtime-smoke.cjs --source --expect-ready
node scripts/updater-runtime-smoke.cjs --source --fail-primary --interrupt-first --expect-ready
```

The runtime fixture launches the installed Electron executable with a fresh
temporary user-data directory. Its own background installation is disabled in
that temporary directory. The fixture refuses installer execution, verifies the
complete downloaded installer and rechecks its cached bytes, then removes only
its guarded temporary directory. Without `--source`, it checks the installed
updater; with `--source`, it loads the repository updater into that same native
Electron runtime. `--interrupt-first` injects one stream interruption after
roughly one MiB; real network failures still count against the three-attempt cap.
`--fail-primary` injects HTTP 504 for the normal manifest and installer routes,
then uses the production fallback with actual public API/CDN bytes. Route labels,
byte counts and stable errors are recorded without URLs. The fixture separately
rehashes the cached installer and confirms no partial files remain.

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

The official fallback implementation was then measured in the same installed
0.4.0 / Electron 45.2.3 runtime with repository updater source. An isolated
`--fail-primary --interrupt-first --expect-ready` run recovered its manifest
through the asset API (555 bytes), discarded an API installer transfer
interrupted after 1,057,524 bytes, and downloaded all 174,192,312 installer bytes
fresh on total installer attempt 3. Signature, signed URL/tag, streaming hash,
size and independent cache rehash passed; status was `ready` with zero partials
and no diagnostic. This proves production fallback and interruption recovery
for that run, not a completed installed upgrade or future network availability.
A following non-induced source run also verified the complete installer and
cache with zero partials. In that run the standard manifest and installer routes
both succeeded on attempt 1, so no fallback was needed. Earlier HTTP 504s remain
historical observations, not a claim that the normal route always fails.

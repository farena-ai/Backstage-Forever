# Security

Report suspected vulnerabilities privately to Frank Arena / Backstage Coding through a contact route you already trust. A dedicated repository security-reporting address has not been established; do not post API keys, private backups or exploit credentials publicly. Include the app version, reproduction steps and expected/actual behavior with secrets removed.

The desktop uses a local renderer, restricted preload bridge and main-process validation. Credentials belong to main-process safeStorage; cloud origins are fixed, Ollama is loopback-only, redirects are rejected and requests are bounded. No telemetry, remote executable content, game process access or play automation is intended. These boundaries require review and tests; they are not a claim of immunity from vulnerabilities.

An exposed API key should be revoked immediately in its provider console. Deleting a local key alone cannot revoke copies elsewhere. Exported profile backups are readable sensitive data. The unsigned preview and experimental addon are not a supported production release; consult docs/RELEASING.md and docs/COMPATIBILITY.md for unmet gates.

Frank approved MIT licensing; see LICENSE. This security policy does not replace its terms.

# Privacy and local data

Backstage Forever has no project-operated backend, telemetry or automatic AI requests. Profiles and provider preferences live in Electron's per-user `userData` directory on this Windows account (normally under `%APPDATA%` using the packaged app name). Profiles include character details, notes and goals and are readable local JSON. They are not encrypted notebooks. Protect the Windows account and any backups.

API keys are handled in the main process only and encrypted with Electron safeStorage in a separate local credentials file. They are not returned to the renderer, written into profile state, or included in app exports. Secure storage is required; there is no plaintext fallback. OS-backed storage does not protect an unlocked account from every malicious program.

AI sends the prompt you explicitly submit to your selected provider. Optional character context is off by default and is limited to name, realm, class and level. Notes and goals are excluded from automatic context. A secret pasted into your prompt still leaves the computer. Ollama requests stay on a loopback HTTP endpoint; cloud requests go to fixed HTTPS provider endpoints. There is no automatic cloud fallback. Provider retention and billing policies apply to data they receive.

Chats are memory-only and disappear when the app closes; they are not included in backups. Exported backups contain readable profiles, notes, goals and preferences, never API keys. Keep backups private. Imported files are validated data; the app does not execute their contents.

Use Delete Key to remove one locally stored credential. Use the app's reset/delete-data control and confirm the native dialog to clear app data and stored keys. Delete exported backups separately. For an exposed key, revoke it at the provider, not just locally. To remove provider-held data, use that provider's controls. Uninstallation may retain per-user data; reset first when handing the computer to someone else. No secure disk erasure guarantee is made.

The optional addon copies a few character details into a panel on request. It has no network, saved profile store, automation or desktop connection.

## Subscription authentication

Subscription mode is explicitly selected separately from API mode. ChatGPT opens an official browser consent flow and keeps app-owned tokens in main-process encrypted storage. Browser cookies are never read or imported. The preview saves one ChatGPT registration/account per installation; reset app data to switch accounts, exporting profiles first if you want to keep them. Backups include only the authentication preference, not credentials.

Claude subscription requests run the unmodified, separately installed official Claude Code executable. Its official login manages credentials inside app-private `claude-subscription` and `claude-home` directories under app userData; the app does not extract or replay its tokens, and it does not silently reuse your general Claude Code login. These credentials are managed by the official tool, not encrypted by the app's API-key safeStorage file. Protect the Windows account and do not copy these directories. Sign-out targets this private login; reset cancels pending operations and removes the app-owned CLI directories, leaving your unrelated global CLI profile alone.

Each Claude request uses an empty temporary working directory, stdin prompt, no shell, no builtin tools, empty strict MCP configuration, disabled customizations/slash commands and no session persistence. Environment API keys, OAuth token overrides and routing variables are removed so subscription mode does not deliberately fall back to API charging. Managed administrator policy can still affect official CLI behavior; this is not an OS-level sandbox. No live sign-in or paid inference was performed by the fixture tests.

Use each provider's official account controls for revocation, retained data and subscription usage. The reset control cannot erase data already held by the provider. Grok subscription mode is unavailable in this preview. Official OAuth exists, but its isolated inference adapter and credential lifecycle are deferred roadmap work.

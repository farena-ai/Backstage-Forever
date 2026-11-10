# Support and recovery

Open **Field Guide → Support & Recovery**, then choose **Prepare report**. Review the displayed snapshot before choosing **Copy report** or **Save report**. Nothing is uploaded or sent to support automatically. Share the copied text or saved `.txt` file yourself only if you want to.

The report contains fixed, bounded facts: app version/channel, operating-system platform and architecture, whether secure credential storage is available, profile count, selected provider ID and configured access mode, whether that provider has a saved key, connection/setup states and coverage counts, public reference status/build/counts, and update phase/known diagnostic code/versions. Configured subscription mode does not prove sign-in, entitlement or remaining quota. Preparing a report does not run a provider CLI, connect to a provider, refresh public data or inspect audio.

The report excludes character/profile/source identifiers and names, realm/race/class, private notes/goals/journeys, conversations and saved memory, prompts, model names, local paths, machine/account identity, URLs, credentials, sign-in metadata, logs and free-form error messages. Unknown or malformed facts appear as `unknown`; this feature does not attempt to redact arbitrary private text from a log dump.

Copy and Save use the exact main-process snapshot shown in the preview, rather than rebuilding it or accepting text/path from the page. A newly prepared report replaces the previous snapshot. Reports expire after five minutes; leaving Field Guide clears its displayed review, and Delete all local data invalidates the stored snapshot. If an action fails or the report expires, prepare and review a new one. A pending save is checked again after the native dialog, so reset, regeneration or expiry cannot write a stale snapshot.

Save uses your chosen text-file destination, with an atomic write. Destinations inside the app-owned data directory are rejected, including canonical directory aliases. No report history is kept. Files you deliberately save elsewhere and text you put on the clipboard remain under your control; reset cannot remove copies you shared.

The checkpoint line currently reads **unavailable**. Automatic recovery checkpoints are a separate planned service; this report does not create or restore them. Until then, use **Protect your journal → Export backup** for a private profile backup. Backups contain private journal content and are different from this small support report. If the journal cannot open at startup, preserve its files and follow the README startup recovery instructions before changing them.

## Developer verification

Use synthetic local data only:

```powershell
node --test tests/diagnostics.test.cjs tests/diagnostics-ipc.test.cjs
npm run test:support
```

The Electron fixture uses isolated temporary data, fake native clipboard/dialog surfaces and synthetic canaries. It checks exact preview/copy/export equality, trusted requests, held controls/focus, layout and navigation/reset races without real player files, account sign-in, audio capture, inference or installers.

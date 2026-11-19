# A2: desktop view presets

Open **Settings → Game connection → Desktop view presets** and select a saved character in the desktop character picker. Choose a preset, then **Preview preset**. The preview lists changes to which sections start open. **Apply preset** saves the choice; **Cancel preview** saves nothing. If the selected character or the saved record changes, preview again before applying.

| Desktop preset | Now: More suggestions | Professions: Where this comes from |
| --- | --- | --- |
| Compact (`compact`) | Closed | Closed |
| Guided (`guided`) | Open | Closed |
| Planner (`planner`) | Open | Open |

The two overrides save immediately and take precedence over the preset. **Use preset default** removes that override. **Reset view preferences** removes the current character’s preset and overrides, restoring both closed defaults. You can still open or close each section with its normal disclosure control. That temporary choice is not a saved override.

The renderer stores `{ version: 1, preset: null | "compact" | "guided" | "planner", overrides: { … } }` in desktop storage under `bf-desktop-view-prefs:<profileId>`. It does not migrate existing preferences or create records on read. Unsupported or malformed records fall back to the default view without being overwritten. These display-only choices stay out of journal backups and are cleared when the character is deleted or the journal is replaced/reset.

The pure resolver in `src/core/desktop-view-presets.cjs` is shared by the renderer and Node tests. Its preview is an effective diff, not a write token. No recommendation order, goals, privacy or permissions, capture, provider settings, Mini Now, or addon/Compass settings change. Nothing syncs to the game or the cloud.

Run `npm run test:desktop-view-presets` for the resolver and isolated Electron keyboard flow, including cancellation, stale preview, overrides, character isolation, restart, reset, and compact German layout. No native game option is involved.

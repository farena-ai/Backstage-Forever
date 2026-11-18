# A2 foundation: desktop view presets

The resolver in `src/core/desktop-view-presets.cjs` is not wired to the app. It describes initial open states for two existing disclosures, not a change to recommendation order, navigation, or available actions.

| Preset ID | Now: More suggestions (`nowMoreSuggestions`) | Professions: Where this comes from (`preparationSources`) |
| --- | --- | --- |
| `compact` | Closed | Closed |
| `guided` | Open | Closed |
| `planner` | Open | Open |

The caller owns storage for one desktop scope and passes only its dedicated JSON record: `{ version: 1, preset: null | "compact" | "guided" | "planner", overrides: { … } }`. The resolver does not select a character or read or write storage. Keep this record separate from account/game settings, permissions, capture, sharing, notifications, pins and goals. Do not sync it to the addon. The roadmap's Quiet/Leveling/Workshop names remain product/UI decisions; the table documents this foundation's desktop IDs.

- `resolveViewPreferences(record)` returns the two effective booleans. A missing or unsupported record uses the existing closed defaults without creating or migrating anything.
- `previewViewPreset(record, id)` returns `{ preset, changes }`, with only effective changes as `{ key, from, to }`. Cancel by discarding that result. On confirmation, call `applyViewPreset(currentRecord, id)` on the current record for that same scope; do not persist a preview diff. If the record or scope changed since preview, re-preview before asking for confirmation.
- `setViewOverride(record, key, boolean)` returns a replacement record. Overrides take precedence across preset changes and JSON round trips. Pass `null` as the value to remove one override.
- `resetViewPreferences(record)` returns `null` to remove that scope's whole view record and restore prior defaults. All command functions reject malformed/unsupported records rather than silently replacing them.

Subsequent wiring should use these values only for initial disclosure state; ordinary in-session disclosure toggles and existing focus behavior remain available. Storage ownership and real keyboard acceptance belong to that later slice. No renderer, IPC, Store, or addon changes are part of this foundation.

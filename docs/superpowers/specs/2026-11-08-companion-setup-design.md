# Companion setup and Adventure Compass design

## Problem and evidence

The owner selected a valid Forever folder but saw only “waiting.” Inspection found an empty app-owned addon folder, neither required loader/script, and no export. The shipped installer must be tested for actual addon preparation, not only desktop startup. First-run manual-profile onboarding hides the game setup. Useful play support also needs actual quests/progress, not only notes.

## Approaches

1. Recommended: guided automatic setup, packaged addon repair, precise health checks, local quest/progress briefing and a compact out-of-combat in-game compass. Uses normal addon APIs and file snapshots; makes permitted assistance useful immediately.
2. Only add a wizard over current buttons: quickest but leaves packaged-copy failure and lack of game-aware assistance unresolved.
3. Continuous desktop telemetry: would require a supported transport or documented account API contract. No memory scanning, hidden pixel bridges, input automation or unofficial token reuse will be introduced to simulate one.

## Experience

First launch prominently offers **Set up my companion**: find the game, automatically prepare/verify the app-owned addon, receive the first character snapshot, and optionally connect AI. Manual/offline setup remains available. Existing installations with incomplete connection receive the same repair journey, dismissible for the current session and reopenable from a persistent setup entry.

Selecting a Forever folder prepares the addon automatically. Discovery checks registry/common drive locations without recursive scans; a native folder picker remains the fallback. Previously connected installations repair missing/outdated app-owned files on startup. Missing addon, installation failure, no first export, unreadable export, unavailable folder and a fresh/stale snapshot each have a distinct explanation and next action. Never force game reload/logout. Tell the player when only `/reload`, enabling the addon or relaunching the game can finish the handshake.

The Adventure dashboard automatically builds a local briefing from selected-character snapshots: level/class/faction/location, XP when public, active quests and objectives, turn-in-ready quests, and context-aware planning buttons. No paid inference runs unattended. A guarded, draggable/collapsible **Adventure Compass** addon panel can display permitted current out-of-combat progress in the game itself; hide it during combat, provide `/bf` visibility/status controls, and never choose combat abilities or operate inputs.

## Data contract

Existing schemaVersion 1 backups remain valid. Add optional profile fields `quests` (array, absent means unavailable; empty means observed empty) and `progress` (`current`, `max`, optional `rested`). Quest entries: `{id,title,level?,zone?,complete,objectives:[{text,done}]}`. Maximum 25 entries, five objectives per quest, 200 characters per title/objective/zone. All numbers bounded and all addon values checked before inspection. Export remains below 1 MiB; shed older optional detail before exceeding its budget, retaining character identities. Never execute saved Lua.

Approved AI context may include a bounded quest/progress selection only when Use my active character is enabled. Show those exact fields in the preview; exclude notes, goals, account paths, raw GUIDs and credentials. Use shared context construction for every transport.

Game status gains machine-readable checks and one next action; returns no private account paths. Packaged addon sources live outside ASAR as read-only extra resources, with explicit source/dev and packaged paths. Installer only updates its three owned files (loader, snapshot script, compass script), preserving unrelated files. Generation cancellation protects connect/repair/reset/disconnect. Keep previous good profiles when exports are absent/malformed. Never silently re-enable a user-disconnected connection.

## Visual direction

Enchanted adventure command table: class/faction artwork stays central; sculpted bronze/iron graphical buttons, emblem medallions, luminous runes, staged entrance, subtle embers and ambient art motion. Use CSS/SVG for interface ornament and existing original paintings. Respect reduced motion and keyboard focus, avoid flashing, pause nonessential animation in hidden windows, and preserve compact-window usability.

## Validation and delivery

Reproduce the packaged addon-copy failure before fixing it. Test setup diagnostics and repair with synthetic folders, packaged end-to-end install/readback, normal/unsupported/restricted quest APIs in Lua, bounded quests/XP validation and context exclusions, local briefing, first-run/migration setup, journal concurrency and reduced-motion layouts. Independently review the final change. Publish 0.4.0 through the existing signed release pipeline only after checks pass; verify the public update. Repair the owner's named game's app-owned addon files without modifying unrelated game/addon files or forcing a launch/reload. Distinguish actual file preparation from in-client acceptance, which requires the player to load the addon.

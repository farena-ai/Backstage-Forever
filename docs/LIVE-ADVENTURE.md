# Live Adventure — integration plan

Develop on `feat/living-field-journal`; do not change the installed addon or v1.7.0. Build on the Adventure Compass, Profession Coach, World Map, Dungeon Atlas, Badge Case, and Ledger instead of introducing parallel tools.

| Order | Player workflow | Acceptance |
|---|---|---|
| 1 | Open the Badge Case from Now or the character journal, find milestones by collection, and pin an eligible badge in the in-game Compass. | Existing badge IDs remain valid; new criteria use observed evidence and preserve character/account boundaries. No invented dates or floods of historical notifications. Desktop-only milestones and in-game support must not be confused. |
| 2 | Choose one leveling objective or profession target, follow it in play, and resume it next session. | Show one actionable next step and why it was chosen. Check stale, missing and changed-character data. Profession plans separate usable materials, last-seen alt stock and unknowns. Confirm completion only from the matching character’s evidence. |
| 3 | Get a useful detour on the way, or prepare for a dungeon and review what happened afterward. | Suggestions respect the selected objective, can be dismissed, and are quiet in combat. Separate reference boss/quest notes from observed encounters. No inference of a clear from entering an instance. |
| 4 | Pin a reputation target and follow eligible quests and turn-ins. | Build on Ledger standings; show provenance and known prerequisites. Unknown server-specific rewards stay unknown. |

## Release gates

- **Truth and input:** use existing public game APIs and documented local live/saved interfaces. No automated gameplay or changes to protected actions. Distinguish Live, Last saved, Unknown and reference information where the player acts on it. Check combat, character switch, stale/lost link, restart and duplicate events.
- **Presentation:** original Warcraft-inspired artwork; readable targets and tables at standard and compact sizes; keyboard navigation; no text embedded in decoration. Give badge collections recognizable silhouettes, and keep progress readable without relying on color. Use charts only for genuine recorded history.
- **Evidence:** focused replay/fixture checks, app navigation in real Electron, then the integrated regression suite. Before calling the new workflows live-ready, test one leveling objective and one profession objective on a running WoW Forever client, including a save/reload and a live-link interruption. Fixture tests do not stand in for this step.

# Live Adventure — integration plan

Develop on `feat/living-field-journal`; do not change the installed addon or v1.7.0. Build on the Adventure Compass, Profession Coach, World Map, Dungeon Atlas, Badge Case, and Ledger instead of introducing parallel tools.

| Order | Player workflow | Acceptance |
|---|---|---|
| 1 | Open the Badge Case from Now or the character journal, find milestones by collection, and pin an eligible badge in the in-game Compass. | Existing badge IDs remain valid; new criteria use observed evidence and preserve character/account boundaries. No invented dates or floods of historical notifications. Desktop-only milestones and in-game support must not be confused. |
| 2 | Choose one leveling objective or profession target, follow it in play, and resume it next session. | Show one actionable next step and why it was chosen. Check stale, missing and changed-character data. Profession plans separate usable materials, last-seen alt stock and unknowns. Confirm completion only from the matching character’s evidence. |
| 3 | Get a useful detour on the way, or prepare for a dungeon and review what happened afterward. | Suggestions respect the selected objective, can be dismissed, and are quiet in combat. Separate reference boss/quest notes from observed encounters. No inference of a clear from entering an instance. |
| 4 | Pin a reputation target and follow eligible quests and turn-ins. | Build on Ledger standings; show provenance and known prerequisites. Unknown server-specific rewards stay unknown. |

### Confirmed dungeon victory badges

In **Characters → Badges → Dungeons**, earn **First dungeon victory** for one saved dungeon boss win and **Dungeon veteran** for five distinct wins. A dungeon map and encounter ID count once, even across repeat kills, name changes, or difficulties. Entering a dungeon still has its own badge; entry, raid wins, and Atlas reference data do not count as dungeon boss wins or prove a full clear.

These are desktop-only awards for the character that recorded the wins. Unfinished progress reflects the saved encounter journal; earned awards survive that bounded history rolling over. The desktop records the award without assigning an achievement date, and the in-game badge list and Compass are unchanged.

### Named quest-chain badges

In **Characters → Badges → Quest chains**, each badge counts exact completed quest IDs from one character's saved history on a reviewed Forever build. Every listed step must be present: a finale alone, a matching title, a quest in the log, a reference entry, or an aggregate quest count cannot earn the badge. If the client didn't supply a known completed-ID list or the saved build hasn't been reviewed, progress is unavailable rather than zero. These desktop-only awards stay earned if later history is unavailable; BF doesn't guess when they were earned. The in-game badge list and Compass are unchanged.

| Badge | Reviewed path (quest IDs in reported order) |
| --- | --- |
| The Defias Brotherhood (Westfall) | `65 → 132 → 135 → 141 → 142` (Westfall investigation only; no link to the separately reported `155 → 166` sequence is assumed) |
| A Husband's Revenge | `440 → 441 → 530` (The Engraved Ring → Raleigh and the Undercity → A Husband's Revenge) |
| The Missing Shipment | `887 → 890 → 892 → 888` (Southsea Freebooters → both Missing Shipment steps → Stolen Booty) |

The IDs, titles and reported next links were checked separately in the byte- and SHA-256-locked `quests.enUS.json` files for **1.60.1.70888** and **1.60.1.70862**, product `wowf`. Every selected step also has a played turn-in observation in the bundled pack. See the [source lock](../data/forever/source-lock.json) and [Efficient Games attribution and license](../data/forever/NOTICE). The reviewed paths define badge criteria, not prerequisite or availability claims.

### Faction-specific reputation medals

In **Characters → Badges → Reputation**, earn separate **Revered** and **Exalted** medals for Stormwind (`72`, Alliance), Orgrimmar (`76`, Horde), and Timbermaw Hold (`576`, either side). These IDs match the Ledger and Forever reference faction mappings. The medals use the character’s saved faction ID and standing tier, not the displayed name, reputation bar points, or quest/reference data. Progress shows the current saved tier toward the target tier.

An observation must be dated within the character export, match its known client build, and belong to the latest reputation scan. If a collapsed header hides a faction during that scan, its older row can still display in Ledger but cannot establish new medal progress. Expand the faction in WoW and reload or log out to save a fresh observation. Once confirmed, medals stay earned on that character even if a later save omits the row or the standing falls. No award date is inferred. These are desktop-only; the existing any-faction badges, in-game Compass, and reputation target workflow are unchanged. Medals make no claims about quest eligibility or server rewards.

### Reputation targets

In **Ledger → Reputation**, choose a saved faction and pin its next standing for the active character. This uses the same single objective slot as quests and profession ranks; replacement requires confirmation. **Now → Resume reputation** returns to that faction. The plan lists saved quests and ready turn-ins first when Forever reference data associates them with the faction. Other leads are filtered by known eligibility and show reported chain links, not guaranteed prerequisites. Server reward amounts, repeatability, and unlisted requirements are not inferred.

A target completes only after a newer saved observation of that exact faction reaches the standing on the pinned character and matching known client build. Legacy rows still display but cannot prove completion. Collapsed faction rows keep their own previous observation; expand the faction in WoW and reload or log out to export a fresh save. This plan never writes a target or performs an action in game.

## Release gates

- **Truth and input:** use existing public game APIs and documented local live/saved interfaces. No automated gameplay or changes to protected actions. Distinguish Live, Last saved, Unknown and reference information where the player acts on it. Check combat, character switch, stale/lost link, restart and duplicate events.
- **Presentation:** original Warcraft-inspired artwork; readable targets and tables at standard and compact sizes; keyboard navigation; no text embedded in decoration. Give badge collections recognizable silhouettes, and keep progress readable without relying on color. Use charts only for genuine recorded history.
- **Evidence:** focused replay/fixture checks, app navigation in real Electron, then the integrated regression suite. Before calling the new workflows live-ready, test one leveling objective and one profession objective on a running WoW Forever client, including a save/reload and a live-link interruption. Fixture tests do not stand in for this step.

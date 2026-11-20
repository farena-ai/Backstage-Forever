# Dungeon Fieldbook · BF-F01

Open **Adventure → Dungeons & raids → The Deadmines → Open Dungeon Fieldbook**. Other entries still use the standard Atlas details.

- **Before:** Copy the approximate entrance waypoint or show it on the map. Open exact quest records from the last saved log or the Atlas pickup suggestions. Suggestions are reference; check availability and prerequisites in game. Supply checks and role preparation are manual. Star items through the existing loot browser, then compare them in Sheet from **Your wish list here**. That list is the intersection of the active character's stars and the bundled dungeon loot records, not inventory or a record of personal drops.
- **Inside:** Three reviewed cues are **Classic reference only**. Mr. Smite's notes retain the stun, weapon change and guards; Captain Greenskin's and Edwin VanCleef's retain preparation for the adds. The two Classic references below support those limited cues. Health thresholds, guard counts, positioning guarantees and later spawn timing are omitted. Community encounter reports are separate; seeing a boss reported in Forever does not verify its mechanics there.
- **After:** The Fieldbook shows dated local Journal defeats for this character in this dungeon, newest first. It is bounded observation history, not a run tracker. No saved defeat does not establish what happened. No clear, lockout or personal loot is inferred.

## Classic references

- [The Deadmines — Warcraft Tavern](https://www.warcrafttavern.com/wow-classic/guides/deadmines/), sections for Mr. Smite, Captain Greenskin and Edwin VanCleef.
- [Deadmines Dungeon Guide — Icy Veins](https://www.icy-veins.com/wow-classic/deadmines-dungeon-guide), §§5.5, 5.7 and 5.8.

## Qualification

`node scripts/dungeon-atlas-recap-smoke.cjs` exercises the real desktop renderer, IPC and local wish list using synthetic state in an isolated profile. It checks the exact entrance waypoint and map, quest and item IDs, the character switch, and the unchanged details on non-pilot entries. It does not qualify a live WoW Forever run, any new addon capture, or release packaging.

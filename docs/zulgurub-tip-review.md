# J31 raid boss tip review — Zul'Gurub opening batch

These are **Classic references**, not confirmed Forever encounter behavior. Warcraft Tavern puts Jeklik, Venoxis, and Mar'li first in both of its suggested Classic routes; that is not a required kill order.[1] ForeverDB lists the same three at the start of its Forever client encounter roster and distinguishes client listings from Classic spawn data. The listing alone does not establish live raid availability, creature GUIDs, or how the fights play in Forever.[3]

## Target identity and tactics

The pinned CMaNGOS Classic DB 1.12.1 dump supplies the English names and creature IDs from `creature_template` and the map from separate `creature` rows. All three static spawns are on map `309`; the compressed dump's SHA-256 is `4f92db520868ab4e566726f68b5b2e380ae781209beaf22237b4f7f04600d0c0`.[4] The independent Classic NPC entries linked below corroborate the names and IDs. The spawn row keys are for auditing the SQL, not IDs to match in target GUIDs.

| Boss (Classic creature ID) | Classic spawn row `(guid, id, map)` | Cross-checked advice |
| --- | --- | --- |
| High Priestess Jeklik (`14517`)[5] | `(3090595, 14517, 309)`[4] | Kill the bat adds, interrupt her heal, and move out of the fire.[1][8] |
| High Priest Venoxis (`14507`)[6] | `(3090592, 14507, 309)`[4] | Control and kill the snake adds early. Move out of poison clouds once he transforms.[1][8] |
| High Priestess Mar'li (`14510`)[7] | `(3090594, 14510, 309)`[4] | Kill spider adds quickly. Have an off-tank ready to pick her up after Enveloping Webs.[1][8] |

## Scope and verification

- Thekal, Arlokk, Mandokir, Jin'do, Hakkar, Gahz'ranka, and the rotating Edge of Madness event[2] are outside this batch; no tips were added for them. The existing Atlas roster is unchanged.
- The tips omit fixed timings, health thresholds, add counts, and exact positioning. In particular, they do not prescribe a Venoxis melee strategy after the transformation.
- The Atlas, Companion, and generated addon use the same `Classic reference:` text. Both the automatic target tip and `/bf boss` require the matching English target name and creature GUID ID in a raid on map `309`; there are no timers, mechanic-triggered alerts, or encounter-history writes.
- Synthetic tests replay both addon tip paths with matching and mismatching targets and instance information. No live Forever client or player data was used for verification.

## Sources

[1] https://www.warcrafttavern.com/wow-classic/guides/zg
    > "Make sure to immediately move out of the fire that appears where the bombs land."
[2] https://wowcalc.net/en/classic/wiki/raids/zul-gurub
    > "check the active event and prepare the summon before entering."
[3] https://foreverdb.net/dungeon/309-zulgurub
    > "10 bosses, in the client's order:"
[4] https://raw.githubusercontent.com/cmangos/classic-db/e4825cf48176edff313d78de66b0beb14371c8eb/Full_DB/ClassicDB_1_12_1_z2815.sql.gz
    > "CREATE TABLE `creature`"
[5] https://wowclassicdb.com/npc/14517
    > "High Priestess Jeklik"
[6] https://wowclassicdb.com/npc/14507
    > "High Priest Venoxis"
[7] https://wowclassicdb.com/npc/14510
    > "High Priestess Mar'li"
[8] https://wowcalc.net/en/classic/guides/raids/zul-gurub
    > "Spider form: Enveloping Webs roots everyone in melee and she charges a ranged player; a second tank must pick her up."

# J31 raid boss tip review — Blackwing Lair

These are **Classic references**, not confirmed Forever encounter behavior. ForeverDB and WowCoach list Blackwing Lair's eight bosses from the Forever client files; that listing does not establish raid availability or how the fights play in Forever.[2][3]
ForeverDB labels its Classic fallback data separately.[2]

## Target identity and tactics

The names and creature IDs match Warcraft Tavern's Classic NPC links and the `creature_template` rows in the pinned CMaNGOS Classic DB 1.12.1 dump.[1][4]
For the seven static spawns, check the table below against the dump's `creature` columns `(guid, id, map)`; each is on map `469`.[4]
The compressed dump's SHA-256 is `4f92db520868ab4e566726f68b5b2e380ae781209beaf22237b4f7f04600d0c0`.
These are Classic creature IDs, not journal encounter IDs or Forever GUID observations.

| Boss (Classic creature ID) | Classic spawn row `guid` | Cross-checked advice |
| --- | --- | --- |
| Razorgore the Untamed (`12435`) | `4690013` | Use the control orb to have Razorgore destroy the eggs while the raid holds off the adds.[1][2] |
| Vaelastrasz the Corrupt (`13020`) | `4690089` | Set a tank order; players who get Burning Adrenaline and are not tanking should move away from the raid.[1][2] |
| Broodlord Lashlayer (`12017`) | `4690004` | Keep backup tanks ready for Knock Away and account for the healing reduction from Mortal Strike.[1][2] |
| Firemaw (`11983`) | `4690003` | Break line of sight to let Flame Buffet stacks fall off; tanks coordinate Wing Buffet.[1][5] |
| Ebonroc (`14601`) | `4690327` | Swap tanks when Shadow of Ebonroc lands so his hits do not heal him.[1][5] |
| Flamegor (`11981`) | `4690002` | Hunters use Tranquilizing Shot for Frenzy; tanks coordinate Wing Buffet.[1][5] |
| Chromaggus (`14020`) | `4690161` | Break line of sight for breaths, clear Brood Afflictions, and use Hourglass Sand for the bronze affliction.[1][5] |
| Nefarian (`11583`) | Summoned; see below | Handle the opening drakonids, prepare for class calls, and control the resurrected skeletons late in the fight.[1][5] |

**Nefarian's target is the dragon, not the encounter starter.** Blizzard's Classic raid announcement links to creature `11583`.[6]
The SQL dump has that creature template but no static `creature` row for it; it places Lord Victor Nefarius (`10162`, spawn `4690001`) on map `469`.[4]
The Blackwing Lair instance script summons `NPC_NEFARIAN` from that creature, and the instance header identifies the summoned NPC as `11583`.[9][10]
The addon does not accept the starter or use a name-only fallback.

The tips omit timings, stack thresholds, tank counts, precise positioning, and seasonal variants. The Instance Atlas, Companion, and addon display the same short text. Both automatic target tips and `/bf boss` require a matching English name and creature GUID ID in a raid on map `469`. There are no timers, mechanic-triggered alerts, gameplay actions, or encounter-history writes. Synthetic tests check both addon tip paths; live Forever validation has not been performed. Molten Core and other existing tips are unchanged.

## Sources

[1] https://warcrafttavern.com/wow-classic/guides/bwl
[2] https://foreverdb.net/dungeon/469-blackwing-lair
[3] https://forever.wowcoach.gg/dungeons/blackwing-lair
[4] https://raw.githubusercontent.com/cmangos/classic-db/e4825cf48176edff313d78de66b0beb14371c8eb/Full_DB/ClassicDB_1_12_1_z2815.sql.gz
[5] https://wowcalc.net/en/classic/wiki/raids/blackwing-lair
[6] https://worldofwarcraft.blizzard.com/en-us/news/23302788
[9] https://raw.githubusercontent.com/cmangos/mangos-classic/28a26c388a3c817f34cdb4737847a345841b6a08/src/game/AI/ScriptDevAI/scripts/eastern_kingdoms/blackwing_lair/blackwing_lair.cpp
[10] https://raw.githubusercontent.com/cmangos/mangos-classic/28a26c388a3c817f34cdb4737847a345841b6a08/src/game/AI/ScriptDevAI/scripts/eastern_kingdoms/blackwing_lair/blackwing_lair.h

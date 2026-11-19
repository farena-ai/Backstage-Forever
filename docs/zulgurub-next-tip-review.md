# J31 raid boss tip review — Zul'Gurub second batch

This batch adds four **Classic reference** tips after the [opening batch](zulgurub-tip-review.md). It does not establish live Forever availability, creature GUIDs, or mechanics.

## Target identity and tactics

Match the English creature name and the NPC ID component of a `Creature` GUID in a raid on map `309`. The pinned CMaNGOS Classic DB 1.12.1 dump identifies the targets in `creature_template`.[3] The table links each independent Classic NPC entry. Check the map separately in the spawn records. The dump used below has compressed SHA-256 `4f92db520868ab4e566726f68b5b2e380ae781209beaf22237b4f7f04600d0c0`.[3]

| Boss (Classic creature ID) | Map evidence in pinned Classic DB | Cross-checked advice |
| --- | --- | --- |
| High Priest Thekal (`14509`)[4] | `creature` row `(guid, id, map) = (3090593, 14509, 309)`.[3] | Bring Thekal and both zealots down evenly so they die together. Kill the tiger adds after he transforms.[1][2] |
| High Priestess Arlokk (`14515`)[5] | No static `creature` row.[3] See the gong summon below. | Control the panthers chasing the marked player. Have the tank pick Arlokk up again when she reappears.[1][2] |
| Bloodlord Mandokir (`11382`)[6] | `creature` row `(3090529, 11382, 309)`.[3] | Stop moving, casting, and attacking if targeted by Threatening Gaze. Mandokir enrages when Ohgan dies.[1][2] |
| Jin'do the Hexxer (`11380`)[7] | `creature` row `(3090528, 11380, 309)`.[3] | Destroy healing wards and Brain Wash Totems. Players with Delusions of Jin'do can kill the shades.[1][2] |

**Arlokk's summon, not a static spawn:** SQL `gameobject` row `(3090272, 180526, 309)` places the Gong of Bethekk in the raid. Its `gameobject_template` row is type `10` (goober) with `data2 = 9066`; the core starts that goober event on the object's map.[3][8]

The `dbscripts_on_event` row begins `(9066, 10000, 0, 10, 14515, …)`: command `10` is `SCRIPT_COMMAND_TEMP_SPAWN_CREATURE`, with `datalong` as the creature entry; the command uses `WorldObject::SummonCreature` on the source map.[3][9][10]

The addon matches `14515`, not the gong's `180526`, event `9066`, or encounter ID `791`.[3][5]

## Scope and verification

- The guides differ on when to clear Arlokk's panthers; the tip does not prescribe a kill window or positioning. Thekal's exact kill window, Mandokir's raptor kill order, and Jin'do's ward-versus-shade priority are not prescribed.[1][2]
- Hakkar, Gahz'ranka, and Edge of Madness are outside this batch; the Atlas roster is unchanged.
- Atlas, Companion, and the generated addon use the same `Classic reference:` text. The targeted Lua replay runs the relevant TOC modules in order and exercises both the registered target-change event and the registered `/bf boss` handler with matching and mismatching identities. It does not run a live client or create encounter-history evidence.

## Sources

[1] https://www.warcrafttavern.com/wow-classic/guides/zg
    > "However, Thekal and the two zealots must be killed within 10 seconds of each other."
    > "During the entire fight, there will be several weak panthers that spawn and focus on marked targets."
    > "The first of these is Threatening Gaze."
    > "Killing Mandokir’s raptor, Ohgan, will send the boss into a minute-long enrage that vastly increases his damage."
    > "Because of this, Delusions of Jin’do should not be removed."
    > "Mandokir is a unique fight, but isn’t extremely difficult if you carefully pay attention to two mechanics. The first of these is Threatening Gaze. When this happens, he will focus a random raid member. They must immediately stop all actions and stay still until the boss is done looking at them. If they continue DPSing, they will get swiftly killed. In the event a main tank is targeted, DPS should slow done so aggro is not lost."
    > "When there are no shades alive, the next priority is Jin’do’s Powerful Healing Ward. Without healing debuffs, this will restore around 3% of his life for every tick. This can be somewhat combated by using mana draining abilities because he won’t spawn the totem if he has no mana. If shades and healing totems are dead, then the raid must watch out for Brain Wash Totems. This will mind control a nearby raid member, but this effect ends as soon as the totem dies."
[2] https://wowcalc.net/en/classic/guides/raids/zul-gurub
    > "Damage dealersBalance damage on all three so they die together, then kill the tigers and finish Thekal."
    > "The panther priestess, called by her gong. She marks a player for her panthers, vanishes and returns, gouges and casts Shadow Word: Pain."
    > "TanksOne tank on Mandokir, one on Ohgan. Mandokir enrages when Ohgan dies: kill Ohgan when the raid is ready."
    > "HealersDispel Hex on the tank. Don't remove Delusions: cursed players are the ones who can kill the shades."
    > "TanksOff-tanks gather the panthers released from the cages; the main tank picks her up after each vanish."
    > "Damage dealersKill the healing ward and Brain Wash totem at once. Cursed players kill the shades they see; players in the pit climb out."
[3] https://raw.githubusercontent.com/cmangos/classic-db/e4825cf48176edff313d78de66b0beb14371c8eb/Full_DB/ClassicDB_1_12_1_z2815.sql.gz
    > "CREATE TABLE `creature`"
[4] https://wowclassicdb.com/npc/14509
    > "High Priest Thekal"
[5] https://wowclassicdb.com/npc/14515
    > "High Priestess Arlokk"
[6] https://wowclassicdb.com/npc/11382
    > "Bloodlord Mandokir - WoW Classic - Warcraft DB"
[7] https://wowclassicdb.com/npc/11380
    > "Jin'do the Hexxer"
[8] https://raw.githubusercontent.com/cmangos/mangos-classic/28a26c388a3c817f34cdb4737847a345841b6a08/src/game/Entities/GameObject.cpp
    > "StartEvents_Event(GetMap(), info->goober.eventId, player, this);"
[9] https://raw.githubusercontent.com/cmangos/mangos-classic/28a26c388a3c817f34cdb4737847a345841b6a08/src/game/DBScripts/ScriptMgr.cpp
    > "Creature* pCreature = WorldObject::SummonCreature(settings, pSource->GetMap());"
[10] https://raw.githubusercontent.com/cmangos/mangos-classic/28a26c388a3c817f34cdb4737847a345841b6a08/src/game/DBScripts/ScriptMgr.h
    > "SCRIPT_COMMAND_TEMP_SPAWN_CREATURE      = 10,           // source = any, datalong=creature entry, datalong2=despawn_delay, datalong3=pathId, text1 - setRun - 1, text2 - faction ID, text3 - modelId"

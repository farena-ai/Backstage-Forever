# D2 / J31 raid boss tip review — Zul'Gurub final batch

This batch adds six **Classic reference** tips after the [opening](zulgurub-tip-review.md) and [second](zulgurub-next-tip-review.md) batches. The source review and synthetic client replay do not establish live Forever availability, GUIDs, mechanics, or victory evidence.

## Target identity and tactics

Match the listed English target name and the creature entry component of a `Creature` GUID, in an instance of type `raid` on map `309`. The CMaNGOS Classic DB 1.12.1 dump supplies `creature_template` identities. Its compressed SHA-256 is `4f92db520868ab4e566726f68b5b2e380ae781209beaf22237b4f7f04600d0c0`.[3] The independent Classic NPC links corroborate the entries. Map evidence comes from the separate spawn or summon records below, not from a client encounter listing.[3]

| Boss (creature entry) | Map 309 evidence | Shared cue |
| --- | --- | --- |
| Hakkar (`14834`)[4] | `creature` row `(guid, id, map) = (3090716, 14834, 309)`.[3] | Use a Son of Hakkar's poison cloud before Blood Siphon; have another tank take over during mind control.[1][2][15] |
| Gahz'ranka (`15114`)[5] | Mudskunk Lure spell `24325`, event `9104`; see below.[3][6][7] | Massive Geyser knocks players into the air; give the tank time to regain control.[1][2] |
| Gri'lek (`15082`)[11] | Brazier template `180327`, condition `6029`, game event `29`.[3][9] | Watch for roots and keep away if he comes after you when he grows.[1][2] |
| Hazza'rah (`15083`)[12] | Brazier template `180327`, condition `6030`, game event `30`.[3][9] | Watch for Sleep and quickly kill summoned illusions.[1][2] |
| Renataki (`15084`)[13] | Brazier template `180327`, condition `6031`, game event `31`.[3][9] | Expect a strike after Vanish; the tank picks him up again when he returns.[1][2] |
| Wushoolay (`15085`)[14] | Brazier template `180327`, condition `6032`, game event `32`.[3][9] | Spread out against lightning.[1][2] |

### Summon audit

- **Gahz'ranka:** There is no static `creature` row.[3]
  `item_template` entry `19974` (Mudskunk Lure) uses spell `24325` at Pagle's Point; the `spell_target_position` row begins `(24325, 309, …)`.[2][3]
  The spell's `Effect2 = 61` uses `EffectMiscValue2 = 9104`, which the core dispatches on the caster's map.[3][6]
  `dbscripts_on_event` starts `(9104, 0, 0, 10, 15114, …)`; command `10` uses `datalong` as the creature entry and summons on the source map.[3][7][8]
- **Edge of Madness:** The four creatures have no static `creature` rows.[3]
  The `gameobject` row `(3090008, 180327, 309, …)` places the Brazier of Madness on map `309`, with `gameobject_template` type `1` (button).[3]
  `GameObject::Use` runs the template-use script keyed by the brazier entry on its map.[9]
  Four `dbscripts_on_go_template_use` rows begin `(180327, 5000, 0, 10, <entry>, …)`, with distinct creature entries and condition IDs as listed above.[3]
  Each `conditions` row uses type `12` to check its corresponding active `game_event`.[3][16]
  Command `10` summons the selected creature on the source map.[7][8]
  The guides describe the optional one-of-four rotation, not four guaranteed targets per run.[1][2]

### Deliberate exclusions

- No generic **Edge of Madness** target or aliases for the brazier, summoning lure, Son of Hakkar, event IDs, or client encounter IDs. The four rotating bosses are individually matched, not interchangeable.
- No rotation schedule, fixed timers, player counts, or disputed tactics. Gahz'ranka guides differ on water positioning, so the tip covers only the knockup and tank recovery. Renataki's tip does not prescribe a way to break Vanish.[1][2]
- No encounter record or progression is awarded by reference coverage. No loot or observed-data pack was changed. Hakkar stays at the end of the Atlas reference list.

## Verification

Run `node scripts/build-boss-tips.cjs --check` and `node --test tests/boss-tips.test.cjs`. The same `Classic reference:` text is tested in Atlas, Companion, the registered addon target-change event, and the registered `/bf boss` handler. The replay varies name, creature entry, GUID type, raid type, and map separately and rejects wrong targets, including a different rotation boss with the expected name. The replay uses synthetic client API responses, not a live Forever client.

## Sources

[1] https://www.warcrafttavern.com/wow-classic/guides/zg
    > "The most important part of this fight is the use of Blood Siphon, which occurs every 90 seconds after the pull. This stuns everyone in front of Hakkar while also draining their life, but it can also be used to damage the boss if raid members are affected by Poisonous Blood. This is applied by entering a poison cloud that spawns when you kill a Son of Hakkar, found to the platforms left and right of the boss."
    > "When a tank is being controlled, an offtank should quickly pick up the boss. Any warriors in the group need to use Intimidating Shout on cooldown so that they don’t fear your raid when they are controlled. When you actually initiate the pull, you should make sure ranged members are spread out so that they don’t spread Corrupted Blood. This effect needs to be cleansed, which will make the fight almost impossible if several raid members are getting hit at a time."
    > "Simply DPS Gahz’ranka down until he dies, making sure to give the tank time to regain control of the boss after each knockup."
    > "Killing Gahz’ranka is very easy if you take the fight to the water. This will completely negate any fall damage. Before initiating the fight, make sure to clear out the fish in the nearby moat where you will fight the boss. Everyone beside the main tank should be grouped up behind the boss so they are in range for his Massive Geyser. This will let the main tank quickly regrab threat after the ability is finished."
    > "The Edge of Madness encounter is quite different because there are four total bosses that can appear, but only one of them will spawn during each raid lockout. These bosses do follow a spawn calendar, which means that it will take six weeks to see all four of them. To begin the encounter, a Gurubashi Mojo Madness must be used to extinguish the brazier that is in the area."
    > "Wushoolay is basically a tank and spank fight, but there are a few things to keep in mind. First, he will need to have his mana drained by hunters and warlocks. Second, he will spawn lightning clouds that nobody should stay standing in. Third, ranged attackers should spread out to minimize raid damage. Fourth, your tank should keep the boss faced away from the raid as best as possible while also moving from lightning clouds. Finally, nature resistance is a huge boon here for your main tank because he has an aura of poison. Aspect of the Wild is recommended for the fight."
    > "Renataki is very simple. It is easiest to have the raid (aside from melee) group up because he will Gouge all nearby targets, then casts Vanish. He will then attack a random raid member, dealing a good amount of damage. If he targets a caster, they will likely die. Stealth can be disrupted by the use of AoE damage. Just DPS him down until he dies."
    > "In comparison, Hazza’rah is definitely the toughest of the four bosses. His health pool is not very large, but his abilities can be overwhelming if not quickly dealt with. Casters and healers should stay away from melee range so that they are not affected by his AoE sleep ability. Use HoTs on the main tank so he doesn’t immediately die. The boss will also create illusions that deal massive damage, but have very little health. These must be focused by single target attacks so that they don’t one shot raid members."
    > "Gri’lek is also very simple. Keep the casters and healers spread out and proceed with the fight like a typical tank and spank. Periodically he will grow in size and deal much more damage. When he does this, any threat will disappear and he will start to fixate on various raid members. He is quite slow when this happens, so anyone with aggro should stay out of range so they don’t get one shotted."
    > "The only other thing to be aware of is that he will root raid members, which must be quickly dispelled so they aren’t caught out when fixated. If you are careful with threat, you can bounce him between two separate raid members who will never take a single hit during his big phase."
[2] https://wowcalc.net/en/classic/guides/raids/zul-gurub
    > "TanksTwo tanks: if one is mind-controlled, the other takes over."
    > "HealersBefore each Blood Siphon, the raid gets poisoned in a Son of Hakkar's cloud; don't cure that poison. Corrupted Blood spreads: heal it widely."
    > "A giant fish fished up at Pagle's Point with the Mudskunk Lure. He breathes frost, slams players into the air and throws Massive Geysers."
    > "TanksPull him away from the water's edge; you'll be thrown up, so pick him back up quickly."
    > "One of four trolls, depending on the week, summoned at the Edge of Madness with Gurubashi Mojo Madness. Gri'lek grows and roots, Hazza'rah sleeps players and calls illusions, Renataki vanishes and strikes, Wushoolay throws lightning."
    > "TanksPick up whichever boss appears; Renataki vanishes, so be ready to taunt him back."
    > "Damage dealersKill Hazza'rah's illusions fast; spread out for Wushoolay's lightning."
[3] https://raw.githubusercontent.com/cmangos/classic-db/e4825cf48176edff313d78de66b0beb14371c8eb/Full_DB/ClassicDB_1_12_1_z2815.sql.gz
    > "CREATE TABLE `creature` ("
    > "dbscripts_on_go_template_use: (180327,5000,0,10,15082,259200,0,0,0,0,0,0,0,0,0,-11901.3,-1906.52,65.36,0.87,0,6029,'Zul\'Gurub - Brazier of Madness - Edge of Madness (Gri\'lek)')"
    > "game_event: (29,1,86400,21600,0,0,'Edge of Madness, Gri\'lek')"
[4] https://wowclassicdb.com/npc/14834
    > "Hakkar - WoW Classic - Warcraft DB"
[5] https://wowclassicdb.com/npc/15114
    > "Gahz'ranka - WoW Classic - Warcraft DB"
[6] https://raw.githubusercontent.com/cmangos/mangos-classic/28a26c388a3c817f34cdb4737847a345841b6a08/src/game/Spells/SpellEffects.cpp
    > "&Spell::EffectSendEvent,                                // 61 SPELL_EFFECT_SEND_EVENT"
    > "StartEvents_Event(m_caster->GetMap(), m_spellInfo->EffectMiscValue[effectIndex], m_caster, m_eventTarget, true);"
[7] https://raw.githubusercontent.com/cmangos/mangos-classic/28a26c388a3c817f34cdb4737847a345841b6a08/src/game/DBScripts/ScriptMgr.cpp
    > "Creature* pCreature = WorldObject::SummonCreature(settings, pSource->GetMap());"
    > "if (m_script->condition_id && !sObjectMgr.IsConditionSatisfied(m_script->condition_id, pTarget, m_map, pSource, CONDITION_FROM_DBSCRIPTS))"
[8] https://raw.githubusercontent.com/cmangos/mangos-classic/28a26c388a3c817f34cdb4737847a345841b6a08/src/game/DBScripts/ScriptMgr.h
    > "SCRIPT_COMMAND_TEMP_SPAWN_CREATURE      = 10,           // source = any, datalong=creature entry, datalong2=despawn_delay, datalong3=pathId, text1 - setRun - 1, text2 - faction ID, text3 - modelId"
[9] https://raw.githubusercontent.com/cmangos/mangos-classic/28a26c388a3c817f34cdb4737847a345841b6a08/src/game/Entities/GameObject.cpp
    > "GetMap()->ScriptsStart(SCRIPT_TYPE_GAMEOBJECT_TEMPLATE, GetEntry(), spellCaster, this);"
[11] https://wowclassicdb.com/npc/15082
    > "Gri'lek - WoW Classic - Warcraft DB"
[12] https://wowclassicdb.com/npc/15083
    > "Hazza'rah - WoW Classic - Warcraft DB"
[13] https://wowclassicdb.com/npc/15084
    > "Renataki - WoW Classic - Warcraft DB"
[14] https://wowclassicdb.com/npc/15085
    > "Wushoolay - WoW Classic - Warcraft DB"
[15] https://wowcalc.net/en/classic/wiki/raids/zul-gurub
    > "Before Blood Siphon, use a Son of Hakkar's poison cloud to poison the raid; control mind-controlled tanks and do not cleanse the planned poison early."
[16] https://raw.githubusercontent.com/cmangos/mangos-classic/28a26c388a3c817f34cdb4737847a345841b6a08/src/game/Globals/Conditions.h
    > "CONDITION_ACTIVE_GAME_EVENT     = 12,                   // event_id     0"

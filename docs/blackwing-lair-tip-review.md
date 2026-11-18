# J31 raid boss tip review — Blackwing Lair (opening three)

These are **Classic references**, not confirmed Forever encounter behavior. ForeverDB and WowCoach list Blackwing Lair's eight bosses from the Forever client files; that listing does not establish availability or how the encounters play in Forever.[2][3] ForeverDB labels its strategy Classic data.[2]

The three creature IDs below match the Classic NPC links in Warcraft Tavern and the `creature_template` rows in the CMaNGOS Classic DB 1.12.1 dump.[1][4] The dump's `creature` rows place all three on map `469`.[4] These are Classic creature IDs, not journal encounter IDs or live Forever GUID observations.

| Boss (Classic creature ID) | Cross-checked advice |
| --- | --- |
| Razorgore the Untamed (`12435`) | Use the control orb to have Razorgore destroy the eggs while the raid holds off the adds.[1][2] No egg count, add routing, or orb rotation is prescribed. |
| Vaelastrasz the Corrupt (`13020`) | Set a tank order; players who get Burning Adrenaline and are not tanking should move away from the raid.[1][2] No timing, tank count, or taunt behavior is assumed. |
| Broodlord Lashlayer (`12017`) | Keep backup tanks ready for Knock Away and account for the healing reduction from Mortal Strike.[1][2] No threat percentage, positioning, or cast interval is prescribed. |

The Instance Atlas, Companion and addon display the same short text. Both automatic target tips and `/bf boss` require a matching English target name and creature GUID ID in a raid on map `469`. This is text only: no timers, mechanic-triggered alerts, gameplay actions, or encounter history writes. Synthetic tests cover both addon paths, including unavailable and mismatched identity. Live Forever validation has not been performed.

**Not covered:** Firemaw, Ebonroc, Flamegor, Chromaggus and Nefarian are listed in the client data but remain outside this opening batch.[2][3] Molten Core and all other existing tips are unchanged.

## Sources

[1] https://warcrafttavern.com/wow-classic/guides/bwl
[2] https://foreverdb.net/dungeon/469-blackwing-lair
[3] https://forever.wowcoach.gg/dungeons/blackwing-lair
[4] https://raw.githubusercontent.com/cmangos/classic-db/master/Full_DB/ClassicDB_1_12_1_z2815.sql.gz

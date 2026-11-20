# LIVE-D03 · Observed dungeon progression

Open **Adventure → Dungeons & raids → The Deadmines → Dungeon Fieldbook → Observed dungeon progression**. The pilot is read-only and separate from the existing Atlas recap, Classic reference, and Fieldbook practice flow. It does not use the installed build, request new capture, or add any sharing, export, or provider path.

| Evidence | What qualifies |
| --- | --- |
| Retained boss defeats | Valid dated rows from this character’s addon journal, with instance map **36** and type **party**. Discard rows dated after the character save, deduplicate identical observations, and show up to the five newest qualifying rows. Repeated dated defeats can appear. The existing capture does not record a row’s build; these are marked historical and are **not** attributed to the build of the current save. Missing observations are not a lifetime count. |
| Unfinished quests | A dated, compatible addon save, an exact reviewed quest ID in that log, and `complete: false`. Ready-to-turn-in and completed history are not unfinished objectives. Titles or objective text from the save are not used to match quests. |
| Gear goals | This character’s existing Atlas wish list, intersected with reviewed exact item IDs for the saved build. A gear goal stands independently of the quest and defeat lists. A star does not prove eligibility, ownership, or a personal drop. |

The view supports **saved** Forever builds `1.60.1.70862` and `1.60.1.70888`. The latter has no reviewed gear source in this slice. Unknown or unsupported builds do not yield a combined view. Renderer ownership checks use profile ID, addon source ID, save time, and build; an in-progress character switch retires the outgoing view. None of these observations establishes a dungeon clear or lockout.

## Reviewed relations

The two quest originals corroborate Defias Brotherhood quest **#166** through its VanCleef objective and Underground Assault **#2040** through its explicit Deadmines objective.[1][2] On `1.60.1.70862`, loot `sources["npc:639|group"].items[5202]` reports a drop, and `rolls["encounter:2747|threshold:2"].items[5202]` independently reports a roll. Encounter **#2747** identifies Edwin VanCleef, map **36** and boss NPC **#639**; the same-build item hotfix identifies **#5202** as Corsair’s Overshirt.[3][4][5] The encounter ID in this community reference is not used to join addon journal rows. No mixed-build drop listing is used as evidence. Data from [Efficient Games](https://efficient.games), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

| Original | Build suffix | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| [1] Quests | 70888 | 5178761 | `433fc57290a162eca1c688c277a96234d39b7198edb1326ed4d6ec8fa4a65d60` |
| [2] Quests | 70862 | 4204753 | `7b96a1e976a6746492f8a17e8de9ab1b014f236ebfb01e5f03dbe81880777877` |
| [3] Loot | 70862 | 1658259 | `3f7a3d79de5c09bf64e2dbffdc79377895981c783bd3867b7460a79c44f34da0` |
| [4] Encounters | 70862 | 24298 | `6a0aa51ef84bf7e003439bc0ae6ac7dbb5ef9411e70f3e920cfbeb4c91006ad0` |
| [5] Item hotfixes | 70862 | 706706 | `71bab433efbfd3bd04f579ef0a701c11a2a3ce0bc8daae8d3d5d8efcf5192ce2` |

[1]: https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70888/quests.enUS.json
[2]: https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70862/quests.enUS.json
[3]: https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70862/loot.json
[4]: https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70862/encounters.json
[5]: https://raw.githubusercontent.com/JIVESCORP/eg-link-output-wowf/164bd1e2d89579ada4ee5e2de7e5fd4db684a9f1/data/wowf/1.60.1.70862/item_hotfixes.enUS.json

Run `node --test tests/dungeon-progression.test.cjs` and `node scripts/dungeon-atlas-recap-smoke.cjs`. These use synthetic saves, not a live client.

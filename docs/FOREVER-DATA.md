# Your Forever quest reference

BF includes its quest reference. You do not need an AI connection, account signup or database download to use it. Connect the game, load the updated companion addon, then type `/reload` in WoW to save your character's current progress. BF uses your exact quest IDs and client build to select compatible facts.

The Quest Guide starts with your character's quests. Search locally by name or quest number to inspect reported chain links, quest givers, turn-in NPCs, approximate observed locations and listed rewards. Reward choices mean choose one; they are separate from guaranteed items. Missing details stay unknown. A reported next-quest link does not establish every prerequisite or guarantee that your character can accept it.

Where compatible data supports a destination, Copy game waypoint prepares a short `/bf guide` command. Paste it into WoW yourself. The addon checks the command and quest state before placing a supported marker. If the client cannot place one, it prints coordinates. BF never moves, targets, fights, interacts, automatically reloads or opens game panels for you.

NPC locations record where a player stood while interacting with the NPC. Treat them as approximate observations, not exact spawns or guaranteed routes. Quest facts have a collection date, game build and source report count. One report is not independent corroboration. Server-cache records alone are reference entries, not proof that a quest is playable.

The initial pack comes from Efficient Games' published live Forever observations, collected November 7–8, 2026 for build 1.60.1.70862. It has 3,392 quest cache records and 1,187 reported positive next-quest links, with much smaller observed NPC/objective coverage. BF does not cover every quest, condition or location. Another build may have no matching pack; BF shows that rather than applying unrelated Classic or beta data.

Of those records, 213 have offer, turn-in or objective-progress evidence in the initial pack. Default browsing prioritizes your current quests and records with that evidence. Additional reference-only entries can be inspected explicitly, but they do not independently trigger a recommendation. The pack also has 206 interacted NPC records, 18 interacted objects and objective-position observations for 97 quests. Some optional malformed observations are dropped during normalization; the coverage report records that count.

Automatic reference checks download public whole-build datasets while BF is open. They do not send character names, quests, account details, notes or AI credentials. You can disable automatic checks and refresh manually. If a download fails, the last valid compatible pack remains usable. The last check date and the source's collection date are different things.

Full completed-quest ID sets stay local. When Use my active character is enabled, an explicitly submitted AI question can include a bounded selection of relevant sourced quest facts. The context preview shows the same approved information. Refreshing data, browsing quests and building a plan do not make an AI request.

Data from Efficient Games (https://efficient.games), licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Source: https://github.com/JIVESCORP/eg-link-output-wowf, initial commit 156f29c9af78b1586883e8eb94a13467eb89638c. Backstage Coding filters, normalizes, indexes and combines the published records for BF; these are changes to the source compilation. The app code remains MIT licensed. The publisher's data license does not transfer ownership of Blizzard's game content.

## For source developers

Normal unit tests use tracked small fixtures and the bundled factual pack; no research folder or network access is required. To reproduce the entire initial pack, obtain the six original JSON files from the immutable URLs in `data/forever/source-lock.json` and place them together in a local folder. The compiler checks their SHA256 hashes and byte sizes against the shipped lock before normalization:

```powershell
node scripts/build-forever-data.cjs --source-dir "C:\path\to\source-files" --check
```

This explicit reproduction check is separate from ordinary offline tests. Do not copy a different build, beta data or undocumented prerequisite correlations into that folder and label the result verified. The shipped license and notice must accompany redistributed derived data.

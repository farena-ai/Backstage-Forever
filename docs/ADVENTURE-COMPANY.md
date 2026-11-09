# Your Adventure Company

Company brings your collected characters and shared plans together. It works locally without an AI account. Backstage Forever is from Backstage Coding, designed by Frank Arena.

## See the next useful character

Open **Company**. Character cards show their class/faction, level, saved progress, ready turn-ins and available preparation facts. Private goals remain attached to their character. Choose a card's adventure action to deliberately switch characters; browsing Company leaves your current selection alone.

Counts describe collected observations. A manual character or a missing quest log is not an empty quest log. Save dates matter: your characters may have advanced since their last save. A suggested character is a planning suggestion, not a claim that a route is optimal or content is currently available.

BF can only collect characters visited with the addon enabled. Play additional characters and let WoW save on logout or exit. The desktop imports valid saves automatically. Following your last saved character remains optional; deliberate selection pauses it.

## Make a shared journey

Create a plan and choose a blank journey, quest-session checklist or dungeon-preparation checklist. Templates give you an editable starting point. Choose the dungeon, role and group plan yourself; a checklist is not a gear score or eligibility verdict.

Add a note step, assign it to a character if helpful, and check it off when you decide it is done. You can keep steps unassigned while deciding who should do them. Existing text edits save when you leave the field; checkbox and assignment changes save immediately. Check the visible save/error feedback before closing.

Shared journeys belong to this local BF installation and can span your collected characters. They are not a cloud party channel. No plan is posted to friends or guilds, and no AI question is sent by creating or editing a plan.

The initial limits are 20 journeys with up to 50 steps each. Remove finished plans or unneeded steps if you reach the limit. Deleting a character preserves its steps so you can decide what to do with them; it does not attach them to somebody with the same name.

## Track a quest from a saved log

Choose the character and a quest from its observed saved quest log. BF records that save as the starting point. You do not need to type a quest ID or connect a provider.

Tracking starts from the selected last save, which may be older than the moment you click. A later import can recognize progress since that save, including progress made while the desktop was closed. The native addon still needs to have observed and saved the relevant game information.

BF distinguishes these situations:

- **Ready to turn in:** the saved game says the objectives are complete; a turn-in has not yet been proved.
- **Observed complete:** a newer compatible save supplies a new observed turn-in, or a first transition into a complete known list of completed quest IDs.
- **Manually complete:** you checked the step yourself; that is not a game-verified completion.
- **Unconfirmed:** evidence is missing, older, incompatible or insufficient. Disappearing from the active log does not prove completion.

A repeatable quest that was already historically complete needs a new observed turn-in. An unavailable completion list becoming available does not prove that a quest was just completed. These rules prevent an old achievement from doing a suspicious amount of work on a new checklist.

Observed completion is retained when bounded recent history rolls over. It is labelled with its saved date/build. A later game build or character-identity change does not turn old evidence into a current claim. To track another run, remove/re-add the quest from the appropriate saved log. Converting/reassigning a tracked quest to another character makes it a manual step and clears incompatible tracking evidence.

If BF cannot prove progress, keep playing and let the game save naturally, or mark the step manually if that matches your intent. There is no recurring reload requirement. A voluntary reload is only useful when you specifically want an immediate desktop save or need to load updated addon files.

## A quiet preparation cue in game

Adventure Compass can show a quiet bag-space line when current supported observations report two or fewer free slots in a bag capacity greater than zero. It clears when space improves or the character/session changes. Unknown or unavailable capacity is not treated as a full bag.

The cue uses existing public observations outside combat. It does not play a sound, send a message, buy anything or move your character. It works with the desktop closed. Existing drag, collapse, close, **/bf show** and **/bf hide** controls remain.

## Privacy, backup and freshness

Private notes, character goals and shared journeys stay local. They are excluded from automatic AI context. Anything you deliberately type into an AI question is sent when you submit it; review that question yourself.

Backup/export includes your journeys and character journals, but not provider keys. Import uses the existing replacement confirmation. An older backup without journeys restores an empty shared-plan collection; malformed data leaves the current state intact. A backup from a newer BF version may not be understood by an older version, so update the app before restoring it.

Inside WoW, the Compass updates from permitted current observations outside combat. Company and AI use last-saved desktop data. Normal logout/exit delivers new snapshots. Refreshing the desktop cannot make WoW write unsaved data.

[Living Companion](LIVING-COMPANION.md) · [Privacy](PRIVACY.md) · [Validation](VALIDATION.md) · [Roadmap](ROADMAP.md)

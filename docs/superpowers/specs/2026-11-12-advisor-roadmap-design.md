# Backstage Forever: from information app to live leveling advisor

Date: 2026-11-12. Owner: Claude (Backstage Forever maintainer). Approved direction: Frank, "build it all out in your recommended order".

## Why

Frank's review of 0.16: the World Map is the best part, but the app as a whole reads as "information for its own sake". It should be a top-tier advisor that works with you live: what to do next, where, how, for your class, professions and level. Specific complaints:

1. Adventure → Map is an abstract coordinate grid that duplicates the World Map and looks empty.
2. The in-game map shows far less than WoW's default quest map; it should show at least as much and more (class, professions, where to go, leveling organization).
3. World Map icons are hard to tell apart, and clicking an NPC tells you nothing about them.

## What the codebase has (survey, 2026-11-12)

- Quests: 3,884 with level, minLevel, chains (1,379), givers/turn-ins (177 distinct givers), objective locations, sides.
- Trainers: 34 with full service lists (spell, rank, level). Vendors: 91 with listings. NPC locations: 616. Travel: 17 nodes, 16 flight edges.
- Missing: zone level bands, leveling route, NPC levels, most herb/ore nodes (7 rows).
- Overlap: quest plan in three places (Next step, Quests, in-game Compass); NPC search in three (World Map, Companion, `/bf find`); Professions under Adventure and Plans.

## Sub-projects, in order

Each ships as its own release with the full gate list.

### A. World Map: readable pins and real NPC cards (0.17.0)

- One silhouette per kind: quest shields (`!` pick up, `?` hand in with glow), red crosshair objectives, blue diamond flight masters, hexagon trainers split into class (red, swords) and profession (teal, hammer), square vendors (coin), leaf herbs, rock ore, starred finds, small diamond for other NPCs. The same drawing code renders the legend, search results, "Near you" and the card header.
- NPCs carry faction (pack `side`, or observed reactions ≥ 4). Other-faction NPCs are marked, dimmed with a red slash, hidden by default behind an "Other faction's NPCs" toggle, and kept off the radar.
- `worldMapNpc(npcId)` returns roles, faction, places, quests given and handed in (with this character's status: ready, in log, available, low, too high, done, other faction), trainer services (class trainers split "learn now" vs "later", and say so when the trainer is not for your class), vendor items, flight town.
- Quest rows and objective pins open the quest in Quests.
- Search ranks full-text matches above "any trainer nearby".
- Adventure → Map is deleted (module, IPC, smoke, gates); its useful parts already live on the World Map.

### B. Leveling advisor data (0.18.0)

A small, reviewed, bundled pack plus derived indexes, no network:

- Zone level bands per faction (derived from quest levels per zone, reviewed by hand for the 1–60 zones), with "recommended now / soon / too high" for the character.
- Quest hubs: clusters of givers per zone with level range and faction.
- Class and profession trainers by faction and zone, from insights.
- A suggested leveling path: next hub(s) for your level and faction, which quests to grab there, and when to train.

Success: for any level 1–60 Horde/Alliance character, the advisor can name the next hub, why, and the route there.

### C. Reorganize around a live "Now" page (0.19.0)

- New home: Now. Live status, "do this next" (from B plus your quest log), where (mini map + waypoint), how (objective tips), and short cards for class training due, profession next steps and dungeon readiness.
- Merge the three quest-plan surfaces into Now + Quests; one NPC search (World Map), with Companion and `/bf find` calling the same index.
- Navigation: Now, World Map, Quests, Class & Professions, Dungeons, Companion, Characters, Settings/Help. Plans folds into Now goals.

### D. In-game map and minimap (0.20.0)

- World map: quest givers (`!`) for your level and faction, hand-ins (`?`), objective areas, class and profession trainers, flight masters, vendors you need, the advisor's next hub; tooltips match the app card.
- Minimap: the same pins near you, plus the current step arrow.
- Same data as the app (exported in the addon reference), so the game and app never disagree.

## Constraints

- Original art only; game art is read locally from the player's install and never bundled.
- No input to WoW; the addon only reads game state and draws its own frames.
- Reference data stays source-labelled (Efficient Games, CC BY 4.0).
- 1.0 stays held for Frank's hands-on acceptance.

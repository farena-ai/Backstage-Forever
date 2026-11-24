# Backstage Forever — the "leading addon" roadmap

Written 2026-11-22 against public `main` = **v1.17.0** (`3557ffc`). This is an addition to the existing plans, not a replacement:

- `docs/ROADMAP.md` (history, Tiers 1–J)
- `docs/ALL-IN-ONE-ROADMAP.md`, `docs/FOREVER-COMPANION-NEXT-ROADMAP.md`, `docs/FOREVER-EXPANSION-BACKLOG.md`
- `docs/POST-1.17-ROADMAP.md` (P0–P6, on the local branch `feat/academy-fieldbook-guild-integration`, not yet on `main`)

Those plans are mostly about making what exists trustworthy: evidence gates, recovery, one qualified slice at a time. This document covers the other half: **the features a player would install Backstage Forever for**, where the product is still behind or absent compared with what players stitch together from a dozen addons. Nothing below repeats a row from those files unless it says "extends".

**Ground rules kept:** public WoW API only; nothing played for the player (no automated movement, combat, buying, accepting, crafting); no paid services; Horde and Alliance equal; game art never bundled; every command on Help → Commands; unknown stays unknown.

**Graphics and layout are part of every item (owner direction, 2026-11-22).** No feature below ships as plain text in a stock box. Each one lands with original painted art in the existing style, a tidy layout checked at normal and compact sizes in English and German, and matching looks in game and on the desktop. A feature that needs new art gets it in the same release, not later.

**Client limits every item below was checked against:** no combat log events; secret values; waypoints only from a click or typed command; the addon cannot receive anything from the app while the game runs.

**Legend.** Size: S ≤ a day · M a few days · L a week+ · XL a program. Where: Game / App / Both. For: N = new players, V = veterans. **Probe** = needs a short check in the real client before building, because the API may be restricted on Forever.

---

## Where the product stands (what the code says)

| Area | State at v1.17.0 |
| --- | --- |
| Addon | 36 Lua files, one `/bf` root, about 60 subcommands. Painted Compass, step scroll, toasts, 47 zone banners. World-map layers and guide pins. Item/unit tooltips. Party quest sync. No libraries. |
| Desktop | 8 primary pages, 4 pop-out windows, 146 core modules, 229 test files, English + machine German, Windows + Mac (Mac is saved-only). |
| Data | 4,916 quests, 978 NPC positions, 291 vendors, 27 instances of boss loot, 39 leveling zones, routes for 8 races to about level 42. |
| Companion | Offline answers first; 8 providers; built-in local model; 100 + 60 question benchmarks. |
| Distribution | GitHub Releases is the only feed. CurseForge submitted (in moderation), WoWInterface staged, Wago blocked on an account. |

**Gaps that hold the whole product back** (found while reading; each has a row below):

1. **Features switch off silently on a newer game build.** Detours need build 70888, tooltip hints 70862/70888, the spell-rank reminder 70959, one gathering check 70862. On any other build they do nothing and say nothing.
2. **The in-game addon has no settings window in the game's own options, no menu button, no keybindings.** The only options panel is the 11-checkbox helper box.
3. **The game cannot hear the desktop.** Everything the desktop knows (wish list, plans, community spots, prices) stays out of the game unless the player pastes a command.
4. **Alliance data is thin.** NPC positions: Durotar 166, Barrens 208, Orgrimmar 150 against Dun Morogh 2, Ironforge 6, Elwynn 70. Quests with givers: Horde-only 162, Alliance-only 38.
5. **No route has been hand-reviewed** (`data/forever-route/reviews.json` is empty) and routes end near level 42.
6. **The dungeon reference lives on the desktop only.** In game there are boss tips and nothing else, on a client with no built-in dungeon journal.
7. **Pilots are one deep.** Academy: one spec, levels 23–25. Fieldbook: Deadmines. Gear acquisition: chest slot, 7 relations. Kill hints: 3 quests. Travel: 1 itinerary.
8. **Marketplace users get the addon alone.** CurseForge forbids linking the installer, so the addon has to be excellent with no desktop.

---

## Tier 0 — Foundations that unlock everything else

| # | Feature | Size | Where | For | Notes |
| --- | --- | --- | --- | --- | --- |
| F1 | **Build status, said out loud.** `/bf status` and Help → Data coverage say which game build you are on and whether the data was checked on it, on another build of the same patch, or on an older patch. **Done in 1.17.1.** Still to do: a per-helper list in the in-game settings (with F4). | S | Both | N V | Fixes gap 1. |
| F2 | **One rule for game builds.** Data checked on one build is used on every build of the same patch and says so; a new patch number waits for a fresh check. **Done in 1.17.1** (`src/core/build-compat.cjs`, `BackstageForeverBuildRelation`). Found while building it: the game was on 1.60.1.71037 while the data was pinned to 70888, so quest lookups, the Compass quest reference, saved goals and most 1.17 helpers were blank on the live game. | M | Both | N V | Forever shipped five builds in ten days; exact-build gates meant features were off most of the time. |
| F3 | **Desktop → game hand-off file.** The app writes one addon-owned data file (not SavedVariables) in the addon folder: wish list, chosen route, plan, community spots, remembered prices. The game reads it at the next login or `/reload`. No input is sent and nothing is written while the game holds the file. **1.21:** the same file also carries the dungeon drops rated as upgrades; the in-game atlas marks them green. **1.25:** edited route steps and notes ride in the hand-off. | M–L | Both | N V | Fixes gap 3. The single largest unlock: most rows marked ⇄ depend on it. Needs an owner decision, since current docs say settings travel by pasted command only. |
| F4 | **Settings in the game's own options.** One Backstage Forever category with every helper, each with a sentence in plain words and a "show me" preview. Profiles: Quiet, Leveling, Veteran. **Built for 1.18:** `/bf options` opens one painted window (Quests, Alerts, Comfort; 29 switches; Quiet, Leveling and Veteran starting points) and it is listed in the game's options. The options-list entry still needs a check in the real client. | M | Game | N V | Fixes gap 2. Probe: the Settings category API on Forever. |
| F5 | **Menu button and keybindings.** One minimap/launcher button (left: Compass, right: menu). Bindings for next step, waypoint to tracked quest, Ask, toggle Compass. **Built for 1.18:** right-click the owl for settings (no second minimap button), and four keys in Key Bindings. The bindings still need a check in the real client. | S | Game | N V | The owl stays for Ask. Offer a broker launcher entry for players with a broker bar. |
| F6 | **`/way` compatibility.** Accept the waypoint syntax players paste from guides and chat (`/way 45.2 61.8 Name`), plus a list of your own saved waypoints. **Built for 1.18** (the list of saved waypoints is still to do). | S | Game | V | Typed command, so the waypoint rule holds. Skip when another waypoint addon owns `/way`. |
| F7 | **Works beside other addons.** Tested with the common quest, UI-overhaul, bag and map addons on Forever; detect them and step aside per feature ("another quest helper is drawing pins, ours are off"). **Partly built for 1.23:** detection and step-aside rules (`/bf addons`); not tested beside the real addons. | M | Game | V | Veterans will not uninstall what they have. |
| F8 | **Performance readout.** `/bf perf`: memory, event counts and time per module, with a budget each release must stay under. **Partly built for 1.18:** `/bf perf` reports memory and its change. Per-module timings and a release budget are still to do. **Built for 1.24:** per-module counts and time with `/bf perf on`; budgets are estimates until measured in game. | S–M | Game | V | A big addon gets blamed for every stutter; proof helps. |
| F9 | **One release line.** **Decided 2026-11-22:** public `main` is the only release line and all new work branches from it. `feat/academy-fieldbook-guild-integration` stays as a parking branch for held experiments (Companion quest endpoints, the exact quest leg, local craft and Workshop decisions); each is ported on its own when it earns a place. | S | — | — | The integration branch does not contain the public 1.17.0 commit and differs from it in 72 files. |
| F10 | **Addon alone, first run.** A first-login card in game for players with no desktop: three things it does, the settings button, and a line that the free desktop app exists. **Built for 1.18:** a painted welcome card on first login (Compass, owl, desktop app, with matching medallions) and `/bf welcome` to see it again. | S | Game | N | Fixes gap 8 for marketplace installs. |

## Tier 1 — Questing and leveling, in game (the reason most players install)

| # | Feature | Size | Where | For | Notes |
| --- | --- | --- | --- | --- | --- |
| Q1 | **Quest pins on the minimap.** Available quests, hand-ins and objective spots near you on the minimap, with edge arrows for the tracked one. **Built for 1.19** (`/bf minimap`); placement still needs a check in the real client. | M | Game | N V | Today pins are world-map only, capped at 150. |
| Q2 | **Objective areas on the in-game map.** Shaded areas for kill and collect objectives, from bundled data plus your own progress ticks. **Checked 2026-11-22:** the data holds one spot per objective, so there are no areas to draw. | M | Game | N | The app has them; the game does not. |
| Q3 | **A real direction arrow.** One movable arrow with distance, time to arrive at your current speed, and a colour for "behind you". Used by route, quests, nodes, corpse and party. **Decided 2026-11-22:** the addon already drives the game's own waypoint arrow, which shows distance; an arrow of our own waits until players ask for one. **1.24:** time to arrive and "behind you" on the route step. | M | Game | N V | Replaces the per-feature arrows. |
| Q4 | **Quest tracker by distance.** Your log sorted nearest first, with a level colour, a "ready" mark and a click for the waypoint. Groups by zone. **Built for 1.23** (`/bf tracker`, opt-in, separate from the game's tracker). | M | Game | N V | Probe: adding to or replacing the default tracker without taint. |
| Q5 | **Available-quest finder.** "7 quests you can pick up in this zone" with a list, level colours and which lead into chains. **Built for 1.19:** `/bf available` lists them nearest first with distance and direction. | S–M | Game | N V | Data exists (878 givers); needs the Alliance drive (D1). |
| Q6 | **Chains made visible.** In the quest window and tooltip: "step 3 of 7", what the chain ends in (reward, attunement, dungeon), and what to keep. **Partly built for 1.19:** `/bf chain` says which step of its chain each quest in your log is and what comes next. The quest window and tooltip lines are still to do. **1.24:** step and chain end in quest link tooltips. **1.26:** needed quests come from recorded prerequisites (231 quests). | M | Both | N V | Extends the chain badges. |
| Q7 | **New in Forever lens.** Mark quests, zones, races and instances that exist only in Forever on the map, route and Atlas, with a filter. **Checked 2026-11-22:** the data has no Forever-only marker, so this cannot be built honestly yet. | M | Both | V | Veterans want exactly what is new. Needs a licensed list of the older quest IDs to compare against. |
| Q8 | **Route variants.** The same engine with choices: solo, duo, dungeon-heavy, fewest trips, "careful" (avoids caves, elites and red mobs). **Built for 1.25:** Solo, Duo, Dungeon-heavy, Fewest trips, Careful; the data has no group, cave or pull-size marks, and the cards say so. | L | Both | N V | Extends P1's variants; "careful" serves one-life players. |
| Q9 | **Route editor and share format.** Edit a route on the desktop (drag steps, add notes), export one text file, import someone else's. Reviewed routes ship with the app. ⇄ **Built for 1.25:** editor, notes, own steps, share code, and the edited steps walk in game. | L | Both | V | Turns veterans into contributors and fixes gap 5 faster than one reviewer can. |
| Q10 | **Routes to 60, both factions.** Finish the 42–60 legs and the Dwarf/Gnome opening, one reviewed leg at a time. **1.25:** the refreshed data takes both factions' routes to 60; they are generated, not reviewed leg by leg. | XL | Both | N V | Already planned; listed because nothing else matters as much. |
| Q11 | **Elite and group quest help.** Flags group quests, suggests the level to solo them, and offers a one-click (player-pressed) "looking for group for X" line. **Built for 1.22** (`/bf group`). | S–M | Game | N | Probe: sending to public channels needs a hardware click. |
| Q12 | **Rested and log-off coach in game.** Nearest inn or city, how much rested you would gain by tomorrow, and a nudge when you log out outside one. **Built for 1.22** (`/bf rested`). | S | Game | N | The app has the planner. |
| Q13 | **Weapon skill tracker.** "Maces 12/150: expect misses" when you equip a low skill, and where the weapon trainer is. **Built for 1.22** (`/bf weapons`); no weapon-trainer location yet. | S | Game | N | Classic-era trap for new players. |
| Q14 | **Travel times you learned.** Time each flight you take; later show "Crossroads → Orgrimmar 2m 10s" on the flight map and a progress bar in flight. **Built for 1.22** (`/bf flights times`); no progress bar or flight-map text. | M | Game | N V | Own observations, so it is true for Forever. Feeds the travel planner, which has 1 itinerary today. |
| Q15 | **Full travel planner.** Walk, flight, boat, zeppelin, hearth and (for mages) portals compared, using learned flight paths and Q14 times. **Built for 1.22** for walking, flights and Hearthstone. No boats, zeppelins, tram or portals: the data has none. **1.25:** boats and zeppelins added (stops from the player's game files; ride times estimated). | L | Both | N V | Extends P1 travel; needs the transport data drive (D3). |

## Tier 2 — Dungeons, raids and groups

| # | Feature | Size | Where | For | Notes |
| --- | --- | --- | --- | --- | --- |
| G1 | **Instance Atlas in game.** A window with every dungeon and raid: entrance, level band, bosses in order, loot per boss with "upgrade for you", quests to bring, and the tips. **Built for 1.20:** `/bf atlas` (and a key binding) opens a painted window with all 27 instances coloured by level fit, each with its painting, entrance button, bosses, observed loot with chances and tips. The upgrade-for-you mark on loot is still to do. | L | Game | N V | Fixes gap 6. Forever has no built-in dungeon journal and a journal addon is among its most downloaded. The loot pack is 45 KB. |
| G2 | **Wish list that follows you.** Build it on desktop or in game; a banner when a wished item drops, a mark on the roll window, and "2 of your 5 wishes are in this dungeon". ⇄ **Partly built for 1.23:** wish banner and `/bf wish`; no roll-window mark. **1.28:** guild-run loot notes (opt-in) alongside the wish banner. | M | Both | N V | Probe: roll-window and loot chat events. |
| G3 | **Boss tips for the missing instances.** Blackrock Depths, Lower and Upper Blackrock Spire, Dire Maul, then AQ20, AQ40 and Naxxramas; and the Forever-only instance first. **1.26:** boss roster from recorded fights in 21 instances; tips still need a reviewer. | L | Both | N V | Verified absent. The Forever-only instance is where no other addon has anything. |
| G4 | **In-dungeon panel.** Bosses left, your dungeon quests and their progress, wish-list items still possible, time in the run. Quiet in combat. **Built for 1.23** (`/bf run`, opt-in until seen in game). | M | Game | N V | Uses encounter-end events the Journal already records. |
| G5 | **Attunements and keys.** One page and one in-game list per character: every key and attunement chain, the step you are on, what to do next. **Built for 1.23** as labelled reference: 14 chains; items checked against the installed game. | M–L | Both | V | The veteran checklist; nothing in the product covers it. |
| G6 | **Dungeon quest collector.** For the dungeon you pick: every quest, where it starts, the pre-chain, and which party members still need it. **Partly built for 1.20:** the in-game atlas lists the quests to bring for your side, marks done and in-log, and points to each giver. Pre-chains and who in the party still needs each are still to do. **Built for 1.24** including who in the party still needs each quest. | M | Both | N V | Extends dungeon readiness and party sync. |
| G7 | **Group finder board.** Reads the looking-for-group lines in the channels you have joined into a sortable board (dungeon, role wanted, who, when). Your own post is one button you press. **Built for 1.23** (`/bf lfg`). | M–L | Game | N V | One of the most-used classic-era addon kinds. Probe: chat text may be secret in some contexts. |
| G8 | **Party readiness check.** One button for the leader: who has the quests, the key, food/water, repairs, reagents. Only players running the addon answer; others show "unknown". **Built for 1.23** (`/bf check`). | M | Game | N V | Extends party sync to a useful moment. |
| G9 | **Raid comms.** Party sync extended to raids: leader's notes per boss shown on target, assignments ("you: dispel left side"), a consumables check. **Built for 1.24** (`/bf raid`, off by default); raid addon messages unverified on Forever. | L | Game | V | Text notes, no timers. Probe: addon messages in raid on Forever. |
| G10 | **Resistance and set planner.** Per raid boss, the resistance to aim for and what you own toward it; saved as a gear set. | M | Both | V | Needs reviewed numbers per boss; labelled reference until checked. |
| G11 | **Run history.** Every dungeon and raid run: time, bosses, deaths, loot you got, who you ran with (kept locally). Personal bests per dungeon. **Built for 1.22;** who you ran with is not recorded. | M | Both | V | Extends the encounter journal and the private after-action. |
| G12 | **Loot fairness helpers.** For a group that wants it: a soft-reserve list entered by the leader, shown to all addon users, and a roll summary. No automatic awarding. **Partly built for 1.23:** a soft-reserve list for parties (`/bf sr`); raids not carried. | L | Game | V | Later; only after G9. |
| G13 | **Academy for every class.** Tank, healer and damage basics for all nine classes at three level bands, reviewed per build. | XL | App | N | The pilot is one spec across three levels. GPT holds "DPS Coach" until evidence exists; this is the offline teaching version. |

## Tier 3 — Character, gear and class tools

| # | Feature | Size | Where | For | Notes |
| --- | --- | --- | --- | --- | --- |
| C1 | **Talent planner.** Click-to-spend trees from your own client, compare two builds, respec cost, a share code, and "show me this build's next point" in game on level-up. ⇄ **Built for 1.22:** planner, level-up order, saved builds, compare, share code, `/bf talents`. Starting from your current talents waits on the addon capturing spent points. **1.24:** starts from your current talents. | L | Both | N V | Today: fixed leveling paths only, and in game a toast that points to the desktop. |
| C2 | **Gear plan per slot.** For each slot: what you wear, three reachable upgrades (quest, vendor, craft, dungeon) with where and how, and a target you pin. **Built for 1.23** from quest rewards, vendors, boss and creature drops and known crafts; vendor prices only when you saw them. | L | Both | N V | Extends the chest-slot pilot (7 relations) to all slots. Never called best-in-slot. |
| C3 | **Stat weights you can edit.** Presets per class and role, sliders to change them, and the tooltip verdict follows. **Built for 1.23.** | M | Both | V | Veterans distrust a score they cannot adjust. |
| C4 | **Bag marks.** Small marks on bag items: upgrade, junk, quest item, "needed for a recipe", "an alt wants this". **Built for 1.23** as `/bf bags` plus opt-in marks. | M | Game | N V | Probe: overlays on default bag buttons without taint. |
| C5 | **Character window extras.** Durability per slot, item level, missing enchants, and resistances at a glance. **Partly built for 1.22:** `/bf durability`. Enchants and resistances are not read. | S | Game | V | |
| C6 | **Trainer advisor.** At the trainer: what is worth buying now, what many players skip while leveling, total cost, and what to save for. **Partly built for 1.22:** facts and prices at the trainer on desktop and `/bf train`. No skip advice (needs human review). | M | Game | N V | Needs hand-written skip lists per class, reviewed. |
| C7 | **Hunter pet book.** Which beasts teach which ability rank, where they are, their level, and what your pet still lacks. **Checked 2026-11-22:** no data says which wild beast teaches which rank, so this cannot be built without hand-written lists. **Built for 1.26** from upstream `hunter_pets`: 16 recorded beasts so far; no "your pet lacks" part because the pet's abilities are not saved. | L | Both | N V | A classic favourite with no good Forever source. Needs data capture. |
| C8 | **Class kits.** Warlock: shard count and stone reminders. Mage: portal reagents and which food/water rank to conjure. Shaman: totem quests. Druid: form quests. Rogue: lockpicking places for your skill, poison quest. Paladin and Priest: buff reagent reminders. **Built for 1.22** (`/bf kit`). | M each | Both | N V | Extends the unlock lists and supplies helper. |
| C9 | **Buff and consumable reminders.** Out of combat only: missing class buff, food buff, weapon oil or stone before a dungeon. **Built for 1.22** (`/bf ready`); paladins, warriors and rogues left out. | M | Game | N V | Probe: aura reads are restricted in combat; out of combat they may be readable. |
| C10 | **Reputation planner.** Pick a standing; get turn-ins, quests and dungeon runs that reach it, with what you already hold in bags and bank. **Built for 1.23;** repeatability and per-kill reputation are not in the data and the page says so. **1.25:** amounts corrected to this game's table (50/75/100/150/200). | M | Both | V | Extends "fastest ways up". |
| C11 | **Collections.** Mounts, companion pets, tabards, recipes and rare items: owned, missing, and where each comes from. **Partly built for 1.23:** held mounts, pets, tabards and recipes only; learned ones are not saved. | L | Both | V | Extends D05; only families the client can prove you own. |
| C12 | **Challenge runs.** Opt-in rules you set yourself (one life, no auction house, self-found, no dungeons below a level) with an honest journal, a badge track and a share card. **Built for 1.25** with evidence only where a record exists. | M–L | Both | V | Popular with veterans; the death review and journal already exist. |

## Tier 4 — Professions, gold and the auction house

| # | Feature | Size | Where | For | Notes |
| --- | --- | --- | --- | --- | --- |
| E1 | **1–300 profession guides.** A reviewed path per profession with the cheapest step at each skill range from your own seen prices, and where every recipe comes from. **Partly built for 1.24:** a computed cheapest path from your own prices, labelled as not reviewed. | XL | Both | N V | The product says today it is "not a cheapest/fastest leveling guide". One profession at a time. |
| E2 | **Recipe book.** Every recipe for your professions: known, learnable now, where to get the missing ones (trainer, vendor, drop, quest), and vendor recipes with limited stock. **Built for 1.24** from the client's own recipe tables (2,523 recipes); 1,452 have no recorded source. | L | Both | N V | Needs a recipe list; your own client can supply spells and items. |
| E3 | **Who can craft it.** Across your characters, and with guild members who opt in: who can make an item, and a one-click (player-pressed) whisper. **Built for 1.24** for your own characters and, opt-in, sharing guild members (`/bf guild craft`). | M | Both | N V | Guild part needs addon messages on the guild channel. Probe. |
| E4 | **Gathering loops.** A drawn loop through remembered and community spots for your skill, with the arrow walking you round it, and nodes on the minimap. ⇄ **Built for 1.22:** loop on the World Map, `/bf loop` in game, node pins on the minimap. | M–L | Both | N V | Spots are world-map only today; routes were promised "after 1.0". |
| E5 | **Fishing and cooking.** Pools you found, the skill each zone needs, "cook what you just looted", and the cooking and fishing quests. **Partly built for 1.24:** cooking from your bags. Fishing skill per zone is not in the client data. | M | Both | N V | |
| E6 | **Price history.** Each remembered price keeps its history: a small chart, typical price, and "below your usual price" marks while you browse. **Built for 1.22.** | M | Both | V | Reads only pages you open, as today. |
| E7 | **Craft profit.** For what you can craft: material cost against selling price from your own seen prices, with the date of each price. **Built for 1.22;** vendor prices come from merchant windows you open. | M | App | V | |
| E8 | **Shopping at the auction house.** When the auction window opens, your shopping list is beside it; clicking a line fills the search box (you press search). **Built for 1.23** (`/bf shop`). | M | Game | N V | Probe: writing to the search box from a click. |
| E9 | **Gold per hour, honestly.** Per session and per spot: coin, vendor value and remembered auction value of what you looted. A journal of your own best spots. **Partly built for 1.22:** gold per day only; the addon does not record sessions or open-world loot. **1.24:** coin per hour per play session; loot value outside dungeons still not recorded. | M | Both | V | |
| E10 | **Mail and bank helper.** Expiry warnings in game, "these 6 items are for your tailor" at the mailbox, and a bank tidy list. **Partly built for 1.22:** mail expiry line at the mailbox. | S–M | Game | V | Opening all mail in one click is automation-adjacent; leave it out unless the owner wants it. |
| E11 | **Cooldown calendar.** Every character's profession cooldowns and mail expiries on one calendar, with desktop notifications and a calendar file export. **Built for 1.22** for the three tracked cooldowns and mail expiry, with a calendar file. | S–M | App | V | Notifications only while the app runs; no background service. |

## Tier 5 — World, map and exploration

| # | Feature | Size | Where | For | Notes |
| --- | --- | --- | --- | --- | --- |
| W1 | **Rare and treasure finder.** Known rares and chests on the map with what they drop; an alert when you target, mouse over or see the nameplate of one. **Built for 1.22** from the client's own rare flag (473 rares; only 22 with a place). **1.28:** community layers carry last-seen days and exact own-spot marks. | M | Both | N V | Extends enemy alerts and community finds. |
| W2 | **Danger map.** Where players die, by level, from opt-in anonymous community deaths; in game a line when you walk into a spot that kills players of your level. | M | Both | N | Needs a community server addition (owner deploys). |
| W3 | **Exploration tracker.** Undiscovered areas per zone with a waypoint to each, and XP left to gain from them. **Partly built for 1.22:** `/bf explore` lists discovered areas; the client does not tell addons which are undiscovered. | S–M | Both | N V | |
| W4 | **World map search.** Type any NPC, vendor item, quest or node on the in-game map and get pins. **Built for 1.22:** 3,086 rows and a find box on the in-game map; still 44 maps. **1.27:** desktop search over about 40,000 entries (Ctrl+K) and a wider in-game find with a results panel. | M | Game | N V | `/bf find` covers about 40 maps and 1,193 rows; widen the index and give it a box. |
| W5 | **"Who sells this?"** Vendor stock in tooltips and search, including limited-stock items you saw. **Built for 1.19** on item tooltips, for your faction, with zone names. | S–M | Both | N V | 4,322 vendor listings are bundled but not in the game tooltip. |
| W6 | **"Where does this drop?" in game.** Quest-item and boss drops in the item tooltip. ⇄ **Built for 1.19** for quest items (creatures with chance, and objects); the data file is 73 KB. | S | Game | N V | The addon carries no loot tables today; the two packs total 134 KB. |
| W7 | **Screenshot journal.** An optional screenshot at level-ups, boss kills and badges; the desktop reads your Screenshots folder into the Journey timeline. **Built for 1.23;** the screenshot-on-event switch is unverified in the client. | M | Both | N V | Probe: the screenshot call from an event. |
| W8 | **The story so far.** A chapter page per character: zones, chains finished, firsts, deaths and screenshots, with a share picture. **Built for 1.23** from saved evidence, with a "Not saved" list. | M | App | N V | Was "after 1.0" as E12. |

## Tier 6 — Social, guild and community

| # | Feature | Size | Where | For | Notes |
| --- | --- | --- | --- | --- | --- |
| S1 | **Scout program.** Opt-in "scout mode" that records quest givers, hand-ins, trainers, vendors and flight masters you meet, with a per-zone completeness bar, scout badges and a reviewed path into the bundled data. **Partly built for 1.24:** local scout mode and a file export. The reviewed path into the shared data needs a maintainer process. | L | Both | V | Fixes gaps 4 and 5 with players instead of one reviewer. Needs a new community fact type and the owner's deploy. |
| S2 | **Guild tools in game.** Members running the addon share level, professions and "looking for dungeon X" on the guild channel; a guild page shows who is doing what. **Partly built for 1.23:** opt-in guild sharing and `/bf guild`; no guild page on the desktop. **1.28:** events with sign-ups over the guild channel and a desktop guild page. | M–L | Game | N V | Opt-in per character. Probe: guild addon messages. |
| S3 | **Mentor link.** A veteran and a new player pair up: the mentor sees the mentee's next step and can send a waypoint or a note. **Built for 1.23** (`/bf mentor`). | M | Game | N | Built on party sync. |
| S4 | **Leveling races with friends.** Share splits by file or code; a private board of you against your friends and your own past characters. **Built for 1.23.** | M | App | V | No server needed. |
| S5 | **Friends and notes.** Notes on players you grouped with, where and when; a mark when you meet them again. **Built for 1.22** (`/bf note`, `/bf notes`). | S–M | Game | V | Local only. |
| S6 | **Discord presence.** Optional "Level 34 Hunter in Stranglethorn" status on your own Discord. **Built for 1.25 but off:** needs a Discord application id from the owner. | S | App | N V | Local Discord client connection; off by default. |
| S7 | **Stream overlay.** A local page a streaming program can show: level, XP bar, split, deaths, current step. **Built for 1.23:** loopback page, off by default. | M | App | V | Streamers are the cheapest marketing; nothing leaves the PC. |
| S8 | **Second screen.** Mini Now, the map and the radar served on your home network for a tablet or phone, with a pairing code. | M–L | App | N V | For single-monitor players. Opt-in; home network only, no cloud. |
| S9 | **Share cards for everything.** Level-ups, badges, run summaries and route completions as pictures with one "copy" button; name and realm only if you tick them. **Built for 1.23.** | S–M | App | N V | Extends the badge and journey pictures. |

## Tier 7 — Companion

| # | Feature | Size | Where | For | Notes |
| --- | --- | --- | --- | --- | --- |
| A1 | **Answers inside the game.** With F3, the last answers and the plan are readable in game after a reload; with the Ask panel they stay instant. **Built for 1.24** (`/bf answers`, last five kept). | S | Both | N V | Depends on F3. |
| A2 | **"Explain this" everywhere in game.** A key or modifier-click on an item, quest or NPC opens the Ask panel with that exact thing filled in, unsent. **Built for 1.24** (`/bf explain`, a key binding and optional Alt-click). | M | Both | N | Extends C01 to the game side. |
| A3 | **Spoken companion.** Push-to-talk question, spoken answer, while the game has focus. | M | App | N V | Extends C08. Probe: a global key while WoW is focused. |
| A4 | **Coach's notes after a session.** One screen: what went well, the one thing to change (a death cause, an unspent point, a skipped trainer), tomorrow's first step. **Built for 1.23.** | M | App | N | Built from evidence already saved. |
| A5 | **Teach me my class.** A short, level-aware lesson when you get a key ability, from the reviewed Academy packs. | M | Both | N | Depends on G13. |

## Tier 8 — Platform, languages and reach

| # | Feature | Size | Where | For | Notes |
| --- | --- | --- | --- | --- | --- |
| P1 | **More languages.** French, Spanish, Portuguese, Russian, Korean, Chinese, and a human pass on German. Gathering recording works in every language (match by ID, not English names). **1.24:** French and Spanish added as first translations; German extended. Native reviews still needed. **1.26:** about 200 more lines per language. Attunement directions and the Commands page texts are still English. | L | Both | N V | Gathering is enUS-only today. |
| P2 | **Linux.** A build for players who run WoW through a compatibility layer, saved-only first. **Built for 1.24:** AppImage job in the release workflow; untested on real Linux. | M | App | V | Small audience, loud advocates. |
| P3 | **Mac live link** and a notarized Mac app. | L | App | N V | Already planned; notarization needs a paid Apple account, so it is an owner decision. |
| P4 | **Addon managers.** Finish CurseForge, WoWInterface and Wago so the addon updates through the apps players already use. | S | — | N V | In progress; Wago and WoWInterface wait on the owner. |
| P5 | **Windows package managers.** A winget entry for the desktop app. **Prepared 1.24:** manifests and a generator under `packaging/winget/`; submission is the owner's step. | S | — | V | Free. |
| P6 | **Faster live link.** Move capture to the modern Windows window-capture API if it measures better than the current method. | M | App | N V | Measure first. |
| P7 | **Controller and handheld layout.** Larger Compass and buttons, a radial menu, tested on a handheld PC. **Partly built for 1.24:** a large-buttons setting; no radial menu. | M | Game | N | |
| P8 | **Accessibility in game.** Text size, colour-blind safe marks, optional sounds for arrow direction and alerts. **Partly built for 1.22:** marks without colour and larger text for three windows (`/bf access`). | M | Game | N V | The desktop was audited; the addon was not. |

## Tier 9 — Data programs (what every tier above stands on)

| # | Program | Size | Notes |
| --- | --- | --- | --- |
| D1 | **Alliance parity drive.** Play or scout the six Alliance zones with fewest positions first (Dun Morogh, Ironforge, Loch Modan, Westfall, Darkshore, Teldrassil) and publish a per-zone parity table on Help → Data coverage. **1.25:** Alliance zones with 10+ placed quests went from 7 to 11 of 32 with the refresh; Dun Morogh still has 3. | L | Fixes gap 4. An Alliance scout character plus S1. |
| D2 | **Forever-only content first.** The new races' starting areas, the Forever-only instance, and any new quests: capture, review and feature them before anything already known from older versions. | L | The one area with no competition. |
| D3 | **Transport graph.** Every flight node, boat and zeppelin for both factions, with learned times (Q14). **Partly done in 1.22:** 60 flight points and 191 connections (78 timed) from upstream. Boats and zeppelins still missing. **1.25:** 61 flight points all named, placed and priced with the player's game files; 12 boats and zeppelins; 95 of 207 connections timed. | M–L | 17 nodes and 16 edges today. |
| D4 | **Recipe and trainer data.** Recipes, trainer costs and weapon trainers, read from players' own windows through S1. **Partly done in 1.22:** trainer costs from upstream (1,261 class services; Rogue nearly empty). Recipes not yet. **1.25:** vendor prices and limited stock from upstream; skill levels from the client's SpellLevels table. | L | Unblocks E1, E2, C6. |
| D5 | **Creature abilities for death tips.** Hand-written notes for the mobs that kill the most players (from W2). | M | Makes the death review teach something. |
| D7 | **Data refresh in one command.** Upstream publishes a dataset for every game build (71037 is there). One script that fetches a build, updates the locks, rebuilds every pack and the addon data, and opens a pull request, so the bundled data follows the game within a day. **Checked 2026-11-22:** upstream keeps separate observations per build, and the three builds after 70888 (70938, 70959, 71037) hold more than it does: NPC positions 364 KB against 591 KB, 474 KB and 74 KB; objectives 219 KB against 403 KB and 363 KB. The packs already merge several builds, so adding these three should roughly double position coverage. Upstream also publishes files the app does not read yet: `hunter_pets.json` (C7), `flights.json` (Q14, D3), `quest_prerequisites.json` (Q6), `turn_ins.json`, `trainers.json` (C6, D4), `talent_scan` and `rank_scan` (C1, G13). **Built on `feat/data-refresh`:** `scripts/refresh-forever-data.cjs` and four small helpers re-pin every pack to one upstream commit and seven builds. Result: quests with a giver 910 to 1,536, quest item sources 485 to 809, bosses with loot 47 to 87, creatures 3,272 to 4,772, NPCs with positions 978 to 1,450, vendors 291 to 417, trainers 113 to 180, flight masters 22 to 38, and guided routes that reach level 55 or 56 for every race instead of 42. Also seen in the unread files: `flights.json` routes carry flight **seconds and costs** (280 routes on one build), which is the travel planner (Q14, Q15) from data instead of from each player timing flights; `trainers.json` services carry **costs** (C6); `hunter_pets.json` has 21 pet-training rows so far (C7 needs more). **Done in 1.24:** `scripts/refresh-forever-data.cjs` rebuilds every pack that has a compiler, with `--offline`. Travel, encounters and acquisition are hand-pinned and skipped. | M–L | Today a refresh means editing hash locks and counts by hand across nine compilers. |
| D8 | **Read the game's hotfix cache.** Some items exist only as game hotfixes, so the local game files have no icon, quality or stats for them (owner report 2026-11-22: unnamed, icon-less loot in Ragefire Chasm). 1.20 shows their names from the bundled data and a painted pouch for the icon; reading the client's own hotfix cache would give the real icon, quality and stats. **Done in 1.20.1:** the desktop reads the client's `DBCache.bin` (same build only, read-only) for the two item tables and lays those rows over the installed ones; checked against a live install, where it added about 5,400 items and matched installed rows byte for byte where both exist. Other hotfixed tables (spells, talents) are not read yet. **1.26:** spell names, text and durations follow the hotfix cache; SpellMisc, SpellEffect and SpellLevels are skipped because their column sizes cannot be told for certain. | M–L | Affects loot, rewards, tooltips and gear comparison for every Forever-only item. |
| D6 | **Coverage as a public page.** The same coverage table on the website, updated each release. **Prepared 1.24:** coverage page generated; not deployed yet. **Deployed 2026-11-24.** | S | Honest and good marketing. |

## Tier 10 — Website and release wiring (backstagecoding.com)

How it works (since 2026-11-22): the desktop app is the product on both the home page and `/backstage-forever/`. The three download buttons and the release link start on GitHub's "latest release" page, which is always current, and a small script (`desktop-downloads.js`) turns them into direct file downloads for the newest stable release on every visit. No page carries a version number, so no release needs a website change while the file names keep their pattern. No GitHub workflow touches the website.

| # | Item | Size | Notes |
| --- | --- | --- | --- |
| R1 | **Getting started link follows the release.** **Done 2026-11-22:** it points at `main`. | S | Was pinned to the v1.17.0 tag. |
| R2 | **Links that cannot go stale.** **Done 2026-11-22:** the fixed links are the latest-release page, not a version. | S | Before, a visitor whose browser could not reach GitHub's API got v1.17.0 forever. |
| R3 | **Desktop first, one message.** **Done 2026-11-22:** "No desktop app required" is gone from the home page; both pages lead with the desktop app, which installs the addon. | S | Store badges (CurseForge, WoWInterface, Wago) can sit under the buttons once the listings are live, as a second way in. |
| R4 | **What's new on the site.** Show the latest release notes from the same catalog the app uses. **Prepared 1.24:** `scripts/build-site.cjs` generates the page; not deployed yet. **Deployed 2026-11-24.** | S–M | |
| R5 | **Feature tour and screenshots.** A page per pillar (Compass, Map, Atlas, Companion) with real screenshots, plus the commands list. **Prepared 1.24:** tour page and 19 screenshots generated; not deployed yet. **Deployed 2026-11-24** with 28 screenshots and a search-friendly home page. | M | The site shows one screenshot. |
| R6 | **Release announcement.** Post each release to the Discord automatically with a free webhook. | S | Needs the owner to create the webhook. |
| R7 | **Check the Windows publisher text.** The Updates page still says the installer has no publisher certificate, while the release docs say it is signed by Frank Arena. **Checked 2026-11-22:** the app and README both say the installer is signed by Frank Arena. | S | One of them is out of date. |

---

## Suggested order

1. **1.18 — "It works on patch day and has a front door":** F1, F2, F4, F5, F9, F10, R1–R3, R7. Small, visible, and it makes every later release land better. GPT's P0 reliability list runs alongside.
2. **1.19 — "The quest helper":** Q1, Q2, Q3, Q5, W5, W6, F6. This is the release that makes the addon worth installing alone.
3. **1.20 — "The dungeon journal":** G1, G2, G4, G6, G3 (first batch). Forever has no built-in journal.
4. **1.21 — "Desktop and game as one":** F3, then C1 (talent planner), E4 (gathering loops), A1.
5. **1.22 — "Scouts":** S1, D1, D2, Q9. From here data grows with the player base.
6. **Then by demand:** G5 and G7 for veterans; E1/E2 for professions; C2/C3 for gear; S7/S8 for reach; P1 for languages.

**Decisions only the owner can make:** F3 (the hand-off file), E10 (open-all mail), P3 (paid Apple account), S1/W2 (new community data kinds and the server deploy), R6 (Discord webhook), and whether community sharing stays on by default (the code has it on; some newer planning text assumes off).

**Items that need a client probe before any build:** F4, Q4, Q11, G2, G7, G9, C4, C9, E3, E8, S2, W7, A3.

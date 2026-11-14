# Changelog

## 0.35.1 — the ledger, 2026-11-14

- First published 0.35 build: the v0.35.0 tag was cut before the combat-log fix and its installer build failed on a slow-runner NPC smoke; 0.35.1 carries everything below.

## 0.35.0 — the ledger (tagged, not published), 2026-11-14

- **Fix (ADDON_ACTION_FORBIDDEN on login):** found with a diagnostic probe (event + debugstack): registering `COMBAT_LOG_EVENT_UNFILTERED` is forbidden to addons on this client (BackstageForeverCombat.lua and BackstageForeverMoments.lua, once each per load). Kills now come from `UNIT_HEALTH` on a dead, untapped-by-others target after recent combat; the death review from player health loss credited to the hostile target; `/bf stats` from target health loss in solo fights (healing dropped). Waypoints (`SetUserWaypoint`, `SetSuperTrackedUserWaypoint`, `ClearUserWaypoint`) now only run from clicks and commands (BF Route repaint and the corpse arrow set them from events). Map pins no-op the protected `SetPassThroughButtons`. Guard tests keep the combat log and event-driven waypoints out.
- **H6, first part:** new `BackstageForeverLedger.lua` (per-character `BackstageForeverLedgerDB`): money, bags 0–4, bank (container -1 and bags 5–10, last seen), mail items and money (no senders or subjects), reputations, profession cooldowns, and A7 auction price memory from list pages the player opens (lowest buyout per unit, last 5 observations, 1,500 items). Price memory, then the ledger, drop first when the export nears its size budget. The addon now installs 25 files.
- **App:** Ledger section with Bags & bank (cross-character search), Gold & prices, Reputation and Cooldowns pages; remembered prices on item hover cards; `/bf ledger`, `/bf prices`.
- **0.36 next:** E4 mount and gold goals, E5 class quest chains, A12 gear sets, G5 character sheet.

## 0.34.0 — the community map, 2026-11-14

- **H4 community:** self-hosted `community-server/` (Node, zero dependencies, `node:sqlite`; submit, daily pack, report, forget, health), deployed behind bf.backstagecoding.com. Facts publish only when 3+ installs agree; install ids stored hashed; no IPs stored.
- **App:** community sharing service (gathering nodes and NPC positions, rounded and batched, on by default with off switch and forget), community finds on the World Map, NPC cards and the loot browser, Settings → Community with a "Report a problem" preview, Help and Field guide entries. Vendors, recipe sources and boss drops follow once the addon counts loot per creature.
- **CI:** runs the community server's own tests.

## 0.33.0 — live moments, 2026-11-14

- **Includes 0.32.0** (tagged, installer build failed on a slow-runner race in the knowledge smoke, now fixed): compact v4 live strip.
- **H3 live moments:** kind 3 "moments" pages on the strip (a ring of up to 6, de-duplicated by sequence), new `BackstageForeverMoments.lua` (deaths with killer id and tip code, elite/rare/boss kills, profession milestones, first zone visits, flight paths, upgrades); the app adds dungeon cleared and quest chain finished, resolves names from the bundled packs, and shows painted moment cards, a death screen and Recent moments on Now. `/bf moments on|off|status`. The addon now installs 24 files.
- **Tests:** every Lua test now fails on any stderr (the Lua runner exits 0 after a failed assert); this exposed a death-review tip threshold bug (now 2+ levels above you).

## 0.32.0 — a quiet live link, 2026-11-14

- **H2 live strip v4:** 2-pixel cells at exact physical size, four calibration greys per strip so the app decodes 2 bits per channel by nearest measured level (handles gamma and remote colour curves), 84×4 px for both rows (was 456×12). Heartbeat byte keeps an idle strip live; the addon slows to 1 Hz after 5 still seconds.
- **Placement:** `/bf live pos <corner>`; the capture worker accepts region commands and searches corners only when the strip is lost.
- **Safe mode:** `/bf live safe` draws the v3 strip; v2/v3 still decode. Game connection and Now show mode, corner and size.

## 0.31.0 — every page earns its place, 2026-11-14

- **H1 quality pass:** shared `PageHero` banner on every page with twelve new painted heroes; Quests, Professions, Plans, Party, Characters and Dungeons restyled to the parchment system; Adventure rebuilt without Now duplicates; filler and repeated caveats replaced; Field guide rewritten as task help.
- **Links:** Adventure cards open Dungeons, Professions and the World Map on the saved zone; coach buttons follow the advice kind; Company → Plans and Quest Guide → Quests labels; a smoke clicks every Adventure, Help and Characters button.
- **H5 art:** one class-art set (`art/classes`), Companion owl crest, map-pin art for trainers and quest givers on Coverage, loot-sack and sword step icons on Quests.
- **Stability:** hover cards use their own read-only `questCard` IPC; smokes retry once when Electron fails to launch.

## 0.30.1 — no more "blocked action" notice, 2026-11-14

- **Fixed a taint warning:** the journal's quiet `/played` replaced Blizzard's `ChatFrame_DisplayTimePlayed`. It now mutes `TIME_PLAYED_MSG` on the chat windows for one answer (with a 5-second safety unmute) and never replaces Blizzard functions. New test guards every addon file against global function overrides.

## 0.30.0 — loot, crafts and every node you've found, 2026-11-14

- **Dungeon loot browser (A4):** boss drops from a new `forever-boss-loot` pack (Efficient Games, CC BY 4.0; 47 of 181 bosses recorded so far), item icons and stats from the local game install, upgrade badges, a per-character wish list and an upgrade count on each dungeon card.
- **Hover cards for items and NPCs (E11/D7):** new `itemCard` IPC (stats, upgrade verdict, drop sources) and NPC cards from the World Map NPC data.
- **Professions (2.8/E8):** recipe skill-up colours captured by the addon, best next recipe, skill-up countdown (estimate) and a shopping list with vendor locations. New `/bf prof`.
- **Gathering memory (A6):** up to 500 remembered nodes per character, chests recorded, a gathering heat layer with per-zone counts, and `/bf nodes`.

## 0.29.0 — know more, faster, 2026-11-13

- **Hover cards (A14 first part):** rest on any quest anywhere in the app for its level, how-to steps, giver and reward icons.
- **Death review (E7):** a new `BackstageForeverCombat.lua` explains each death from your own combat log (main source, its share of the damage, level and elite status) and gives one tip.
- **Session stats (A8):** `/bf stats` shows damage, healing, average and best damage per second for this session. The addon now installs 23 files.

## 0.28.0 — your journey, 2026-11-13

- **Characters → Journey:** a badge wall (20 original painted badges for levels, quests, exploring, firsts and speed, with progress on locked ones), speed splits from `/played` with your best across characters, and a rested planner.
- **New badge banner:** shown once per badge, and also triggered from Now.
- **Addon journal (`BackstageForeverJournal.lua`):** levels with a quiet `/played`, firsts, and zones visited, exported as an optional, validated `journal` block. The addon now installs 22 files.

## 0.27.0 — free AI for everyone, 2026-11-13

- **Free AI on this PC, one click:** a pinned llama.cpp b11856 build (graphics-card build with a processor fallback) and Qwen3 4B or Qwen2.5 1.5B (both Apache-2.0). Downloads are resumable and SHA-256 checked, and the engine listens on localhost only. Remove frees the space.
- **Free cloud keys:** Google Gemini and Groq through their OpenAI-compatible endpoints, with key links, a paste field and automatic model choice.
- **Trainer planner:** the next three training levels with spell icons from the local game install.
- **Supplies and class helpers in game:** ammo, food and drink, pet happiness, soul shards and poisons. New `/bf supplies` command.
- **Living headers (G1):** a slow drift and rising embers on the Now header, and gentle zone banner pans. Reduced-motion aware.

## 0.26.0 — follow the steps, 2026-11-13

- **`/bf route`:** an in-game step frame for the current zone (pick up, objectives, hand in) in least-walking order, carried quests first. The game's arrow is on the current step, and the guide moves on by itself as you accept and hand in quests. `next`, `back` and `arrow` options.
- **Quest progress in enemy tooltips:** kills are matched by name; drops come from what you've looted from that enemy.
- **You are here:** a zone card on Now with the level fit, quests for your level and the hub, the inn, the flight master, your trainer, repairs, profession trainers and careful ground, each with a map button.
- **Zone arrival banners** in the app and in game.
- **Painted map pins:** original medallions for the main World Map pin kinds, and painted banners for Orgrimmar and Stormwind.

## 0.25.0 — always current, 2026-11-13

- **Live quest log.** A second row on the live strip pages through your quest log (with done flags) and the quests you've turned in this session. Now prefers it over the last save: handed-in quests leave Now at once and show under **Just completed** with a Completed tag. The Quest log card says Live or "from your last save".
- **Now layout.** Two independent columns with no gaps; the seven main links fit at the default window size; save age is shown next to your status.
- **Reload banner timing.** It names when your last save happened and when the update landed, so an early `/reload` is obvious.
- **Quick answers with no AI.** The companion answers quest how-to, "what next" and training questions instantly from local data when no model is chosen.
- **One-click setup.** **Set it all up** on Now finds WoW Forever, installs the addon and turns on the live link.
- Fixed: Now failed for a character with no saved location. Test windows never take keyboard focus.

## 0.24.0 — how to actually do it, 2026-11-13

- **How to do it, on every quest page.** Plain steps built from the best source available, each saying where its knowledge came from:
  - what you've looted yourself
  - community loot observations: "dropped by Young Goretusk (40% of kills)", or "found in 'Bottle' (click them in the world)"
  - creature levels and elite warnings
  - the quest's own text
  - Guesses are marked as guesses.
  - Where to hand it in comes last.
- **The companion answers "how do I do this?"** It now leads with those steps and the quest text instead of only coordinates.
- **Your quest log's text.** The addon saves each quest's description and objectives from your own log, kept locally. Quest pages and the companion use it.
- **Learns where quest items come from.** When you loot a quest item, the addon remembers whether it came from a creature or an object, which one, and where.
- **`/bf how`** in game prints the how-to for your tracked quest.
- **Community loot reference** for 485 quest items (new data/forever-loot).
- **Objective areas on the World Map:**
  - Soft shaded areas where each objective happens, coloured by how dangerous the creatures are for your level (grey, green, yellow, orange, red), with elite markers.
  - Click one for the objective, the creature's levels and the quest.
  - Creature levels, elite and rare flags, and which factions they attack come from a new community creature reference (data/forever-creatures, 3,272 creatures).
  - Quest pages show creature levels and an Elite chip on objectives.
- **Dungeon readiness.** Each dungeon card has a checklist (does your level fit, which quests to pick up first, the group you need) and a "Pick these up first" list with Show on map and Open quest.
- **Gear review on Characters.** Each slot shows your game's icon and stats and how the piece holds up at your level (fresh, aging, replace soon), with an **Upgrade these first** list.
- **Fix:** World Map clicks on the right side of the map land where you click.
- The addon installer now manages nineteen files. Type `/reload` in game after updating.
- App/lock, TOC and capture metadata align at 0.24.0 preview. **1.0 remains held.**

## 0.23.0 — your game, read for you, 2026-11-13

- **Item, spell and talent facts from your own game install.**
  - Stats, damage and DPS, armor, quality, required level, binding and icons for items.
  - Names, icons and descriptions for spells.
  - Your realm's actual talent trees.
  - Read locally from your WoW Forever files and cached on your PC. Nothing is bundled or uploaded.
- **Quest rewards with everything shown.**
  - Each reward card has the game's icon, stats, damage and DPS, armor and binding.
  - A **Best choice for you** box names the pick for your class and level, with the reasons (e.g. "+6 ranged DPS, +3 Agility"). It compares against your saved gear when the addon has seen it.
- **In game: reward picker.** On the quest reward screen, the best choice for you glows gold with a "Best for you" label, and chat says why. You still click.
- **In game: upgrade hints on item tooltips.** "Upgrade for you: +4 Agility, +1.2 DPS", "Not for you: Priests cannot wear mail" or "Not an upgrade". Use `/bf gear on|off` to switch them, along with the reward glow.
- **Talent coach** (Characters → Talents):
  - A leveling path for every class, laid onto your real trees with your game's icons.
  - Shows how many points you should have by now, with the next point glowing and a "Spend next" list.
  - You can preview any class.
  - In game, the level-up banner reminds you to spend your talent point from level 10.
- **Help → Data coverage.** For each zone, how much the app knows per faction (quest givers, objective areas, trainers, vendors, flight masters), with painted zone headers.
- **Class crests.** Nine original painted class emblems; yours sits beside your name on Now and heads the talent coach.
- **Quest log:** quests that no longer give experience say "No XP · safe to drop".
- **Hearthstone advice in game.** When you pick up quests in a zone while your hearth points elsewhere, a tip names the inn to switch to. `/bf hearth` says the same.
- **Settings → Game connection** lists every in-game helper and how to switch it.
- **For development:** test and preview windows open on a secondary monitor when one exists, so they never cover the game.
- The addon installer now manages eighteen files. Type `/reload` in game after updating.
- App/lock, TOC and capture metadata align at 0.23.0 preview. **1.0 remains held.**

## 0.22.1 — level up like you mean it, 2026-11-13

- **A much bigger level-up celebration in the app:**
  - A full-screen golden burst with slowly turning light rays, a shockwave, three firework bursts and heavier confetti.
  - The winged crest drops in and the number ticks up to your new level, under a shining LEVEL UP! title.
  - **New for you:** the new class skills waiting at your trainer, with "Show trainer on map".
  - Milestone notes at levels 10, 20, 30, 40, 50 and 60.
  - A short, quiet fanfare made on the fly (no audio files), with a Sound on/off switch that remembers your choice.
  - Continue, Escape or a click outside closes it. It stays still if your system asks for reduced motion, and it fits short windows.
- **In game,** the level-up banner is larger, gold-edged and stays up for 9 seconds.
- App/lock, TOC and capture metadata align at 0.22.1 preview. **1.0 remains held.**

## 0.22.0 — dialed in, and the whole quest, 2026-11-13

- **Dialed-in "Show on map".** Every map link from Now (hand in, train, continue a quest, quest hubs, zones, your trainer) and from quest pages opens the World Map focused on that one target:
  - Other pins dim.
  - A gold route runs from you to the target, labelled with direction and distance ("southeast · a short ride").
  - A **Your goal here** card says what to do, step by step, with Open quest and Show the full map.
- **Link audit.** An automated check clicks every Show on map and Open quest link on Now and confirms it lands on exactly that target.
- **Quest pages, first pass:**
  - **Where to go** comes first: pick up from, each objective area (named, e.g. "Kill 12 Southsea Brigand", with how many spots players progressed at) and hand in to, each one click from the dialed-in map.
  - **Rewards** as cards:
    - Item names in their quality colours.
    - Money as coins.
    - **XP at your level**, using the rule observed in real turn-ins: full XP up to 5 levels above the quest, then 80%, 60% and 50%.
    - Reputation with faction names, and reward spells.
  - **Comes after / Leads to** links between quests.
  - Places show zone names instead of map numbers.
- **More from the community data:**
  - Reputation on 2,937 quests.
  - XP data on all 4,916, with a derived base XP for 790.
  - Reward spells on 411.
  - Item quality on 399 reward items.
  - Fully named item rewards on 274 → 435 quests.
- **Art pass 2 on Now.** Original painted crests for each kind of step, and a painted vista for every leveling zone. Twelve landscapes cover all 39 zones: meadow, farmland, canyon, savanna, snow, highlands, haunted, enchanted woods, swamp, jungle, desert and volcanic.
- App/lock, TOC and capture metadata align at 0.22.0 preview. **1.0 remains held.**

## 0.21.0 — repairs, flight paths and a fresh coat of paint, 2026-11-13

- **Repair reminder.** In game, a pop-up when your gear drops to a quarter durability, and again if something breaks. It resets after you repair.
- **`/bf repair`** puts the arrow on the nearest vendor who can repair: 85 bundled repair vendors for both factions (from the community data's own repair flag), plus every repair vendor you open.
- **Flight paths.**
  - The addon learns which flight paths you know from the flight map and from the flight masters you talk to.
  - Passing near a flight master you haven't learned gives one reminder.
  - `/bf flights` lists this zone's masters as learned or not.
  - Flight masters now carry their flight-path ids, and Alliance flight masters show on the in-game map.
- **Alliance vendors.** The vendor reference merges four game builds:
  - 91 → 291 vendors, 62 of them friendly to Alliance (was 0).
  - 1,301 → 4,322 listings.
  - Elwynn, Stormwind, Westfall, Teldrassil and Darnassus now have vendors. Ironforge and Dun Morogh have none recorded upstream yet.
- **Reload prompt.** If WoW is still running an older addon than the one installed, Now says "Type /reload in WoW" until you do.
- **The live link explains itself.** When the strip is on screen but can't be read, the app now says why instead of quietly showing your last save:
  - "old addon still running: type /reload", or
  - "colours are being changed (HDR, Night light, a filter or a remote session)".
  - Now also marks XP and level as "from your last save" whenever it isn't live.
- **Art pass 1.** Original hand-painted high-fantasy art, made locally with ComfyUI:
  - a painted vista behind the Now header
  - a scholar's study behind Help → Commands and the Field guide
  - a winged gold crest behind your level in the level-up celebration
  - a crest for each Commands group
- Help → Commands lists `/bf repair`, `/bf flights`, the repair reminder and the flight path reminder.
- **Fixes:**
  - Background repaints no longer steal keyboard focus.
  - Professions shows each seller once again now that sellers span several game builds.
  - Two long-standing flaky checks are fixed: focus during voice tests, and dropdown contrast during repaints.
- App/lock, TOC and capture metadata align at 0.21.0 preview. **1.0 remains held.**

## 0.20.0 — Alliance too, and every command explained, 2026-11-12

- **Alliance coverage.** Reference data is refreshed to the newest community snapshot and now merges four client builds (1.60.1.70888, 70862, 70840, 70790), newest first:
  - Quest givers with positions: Elwynn Forest 0 → 56, Westfall 1 → 32, Redridge 0 → 25, Stormwind 0 → 19, Teldrassil 0 → 38.
  - Class trainers: 34 → 113, including Elwynn and Stormwind trainers.
  - Characters: 616 → 978 NPCs with 1,786 positions.
  - Horde zones grew too (for example Durotar quest givers 11 → 63).
  - Dun Morogh, Ironforge, Loch Modan, Wetlands and Duskwood stay thin until more players contribute observations.
- The app's reference refresh now merges new data into the bundled set instead of replacing it, so coverage never shrinks.
- Now no longer suggests another race's starting area to a new character (a Human in Elwynn isn't sent to Teldrassil).
- Class training borrows spell lists from another trainer of the same class when your faction's trainer has none recorded.
- **Help → Commands:** every `/bf` command and in-game helper in plain English, with search and a Copy button for each. A test keeps the page in step with the addon, so a new command can't ship unexplained. Now and the Field guide link to it.
- NPC lookups understand Stormwind, Ironforge, Darnassus and Undercity as places.
- Character gear review names equipment slots (Main hand, Tabard…) on every 1.60.1 game build, not only 70862.
- New [roadmap](docs/ROADMAP.md): quick wins through long-term programs, with a suggested release order.
- App/lock, TOC and capture metadata align at 0.20.0 preview. **1.0 remains held.**

## 0.19.0 — a coach at your side, 2026-11-12

- **In game, help at the moments new players get lost** (new BackstageForeverAssist.lua):
  - **Danger warnings** above the target frame in plain words: skull, elite, world boss, much higher level, rare, or too low to give XP.
  - **Death help.** A pop-up explains Release Spirit, and an arrow points you back to your body when you're a ghost.
  - **Pop-ups** for level-ups (naming your nearest class trainer) and finished quests ("+450 XP · about 4 more quests like this to level up").
  - A **Sell junk** button on vendor windows that lists your grey items and their value. It sells only when you click it, and never in combat.
  - New commands: `/bf train` (an arrow to your class trainer), `/bf xp` (XP per hour, time to level, rested XP), `/bf hearth`, and a plain `/bf help`. `/bf toasts`, `/bf danger` and `/bf junk` turn each helper on or off.
  - A one-time welcome on each character.
- **Plainer Adventure Compass.** The setup line, the help hint, the focus and time buttons, and the XP line (now with percent and a rested marker) use everyday words.
- **Now gets set-up and session help:**
  - A **Get set up** checklist ticks itself off: connect the game folder, install the addon, `/reload`, then see yourself live.
  - A **This session** card shows your XP bar with the rested bonus, time played, progress, levels an hour, time to the next level, deaths and zones visited. Pace counts only time you're playing.
  - **You died** becomes the first step until you're back on your feet.
- **Level-up celebration** in the app, wherever you are.
- **My path this session** on the World Map: a glowing trail of where you walked, with a star where you levelled and a cross where you died. It's a layer you can turn off.
- **Field guide:** a "New to WoW? Start here" section and a pocket glossary (quest giver, hand in, rested, hearthstone, trainer, flight master, enemy level colours, elite, pulls, corpse runs, durability, vendor trash, dungeons).
- **Fixes:**
  - Quest rows in the World Map NPC card are readable again; they were dark on dark.
  - The XP bar and confetti respect the app's content security policy.
- The addon installer now manages seventeen files. Type `/reload` in game after updating.
- App/lock, TOC and capture metadata align at 0.19.0 preview. **1.0 remains held.**

## 0.18.2 — live link that survives remote access, 2026-11-12

- The live strip is now version 3: every colour channel is fully on or off (one bit per channel) and cells are 6px, calibrated against white and black markers. Colour shifts from remote sessions, HDR, gamma or colour profiles, slight blur and resizing no longer break it. The strip is a little longer (about 456×6 px at the top-left).
- The app measures the strip's cell size from the image and still reads the older strip, so a not-yet-updated addon keeps working.
- App/lock, TOC and capture metadata align at 0.18.2 preview. **1.0 remains held.**

## 0.18.1 — hand-ins you can see in game, 2026-11-12

- BF Guide hand-ins come from WoW's own quest locations first, then the reference, then the quest giver (where quests usually go), so finished quests always get a pin and `/bf next` picks them first. The Now page uses the same giver fallback.
- BF Guide pins draw above WoW's quest markers instead of underneath them.
- The BF Layers panel sits inside the map, so reskinned map frames no longer cover it with their title bar.
- Now says "Next spells at level N" so it can't be read as your level.
- App/lock, TOC and capture metadata align at 0.18.1 preview. **1.0 remains held.**

## 0.18.0 — Now, and a guide on the in-game map, 2026-11-12

- **Now** is the new home page: "Do this next" (hand in finished quests at the nearest NPC, train new class skills, continue your nearest quest, or head to the zone that fits), where to level (zones for your level and faction with how many quests you can pick up and their base town), quests to pick up there, class training now and at your next level, and your quest log. It follows the live link: change zone, level or quest progress and it updates. "Show on map" opens the World Map on the real NPC.
- Leveling advisor: a reviewed 1–60 zone table for both factions (data/forever-leveling) combined with quests observed in play, which override the table where they exist; quest hubs from where your quests start; class training from observed trainer services.
- In game, a **BF Guide** layer on WoW's world map (docked under BF Layers): quests to pick up (level, faction, completed quests and quest log checked live in game), quest hand-ins, your class trainer and weapon masters, profession trainers and flight masters, drawn with WoW's own interface icons. Click a pin for WoW's waypoint arrow; hidden in combat.
- `/bf next` sets WoW's waypoint on the nearest hand-in, or else the nearest quest to pick up.
- The addon installer now manages sixteen files (adds BackstageForeverAdvisorData.lua and BackstageForeverAdvisorMap.lua). Type `/reload` in game after updating.
- App/lock, TOC and capture metadata align at 0.18.0 preview. **1.0 remains held.**

## 0.17.0 — a World Map you can read, and NPCs that tell you something, 2026-11-12

- Every pin kind has its own shape: quest shields (! to pick up, ? to hand in), red crosshair objectives, blue diamond flight masters, hexagon trainers split into class (swords) and profession (hammer), square vendors, leaf herbs, rock ore, starred finds. The legend, search results, "Near you" and the card use the same icons.
- Clicking an NPC shows who they are: roles, faction, the quests they give and take with your status (ready, in your log, available, level too low, done), what a class trainer teaches you now and later (or that they teach another class), full vendor wares, and where else they've been seen. Quests open in Quests.
- Other-faction NPCs are hidden by default behind a toggle, dimmed when shown, and kept off the radar.
- Search ranks exact matches first ("hunter trainer" finds the hunter trainer, not the nearest cook).
- Adventure → Map is removed; the World Map does its job on real terrain.
- App/lock, TOC and capture metadata align at 0.17.0 preview. **1.0 remains held.**

## 0.16.3 — new characters explained, 2026-11-12

- WoW saves addon data only on /reload or logout, so the app can't know a brand-new character until then. The addon now says so once in chat for a new character, and the World Map reads "WoW is on a new character · /reload once in game so the app can link it" instead of a vague "not live". A live frame from another saved character says to switch characters.
- Live frames streamed into an open World Map now respect the character match too (previously only the initial map build checked it).
- App/lock, TOC and capture metadata align at 0.16.3 preview. **1.0 remains held.**

## 0.16.2 — a live arrow you can see on real maps, 2026-11-12

- The live arrow on the World Map and radar is now a bright blue arrow on a dark disc (red in combat), with a blue trail, so it stands out on the game's warm, gold zone art. The old gold arrow blended into it.
- Live frames bind only to a character whose live key was read from the addon's saved data; an unknown key no longer falls back to accepting the frame.
- App/lock, TOC and capture metadata align at 0.16.2 preview. **1.0 remains held.**

## 0.16.1 — live position shows in the app, 2026-11-11

- Fixed: the World Map arrow, "● Live" status and the companion's live context ignored every live frame from a real character. The app stores characters under a private digest of the game id, but compared it with the addon's live key (a hash of the raw id), so they never matched. The live key is now learned while reading the addon's saved data; frames from another character are still dropped.
- App/lock, TOC and capture metadata align at 0.16.1 preview. **1.0 remains held.**

## 0.16.0 — real zone maps from your game, live link on by default, 2026-11-11

- World Map and radar now show each zone's real map art, read from the player's own WoW Forever installation (local storage, DB2 map tables, BLP textures) with every explored-area overlay, composed once per game build into a local cache. Nothing is bundled, uploaded or redistributed; the procedural parchment remains the fallback when the game isn't connected or a zone has no art.
- Radar keeps the map's true proportions so terrain and pins line up.
- The live game link is on by default for new installs and every character (an explicit off is remembered); the addon explains the top-left strip once in chat.
- World Map says why your position is not live (WoW minimized, window covered, link off, game not running), clears a stale live arrow, and puts the "last saved" label on a readable plate.
- App/lock, TOC and capture metadata align at 0.16.0 preview. **1.0 remains held.**

## 0.15.1 — pop-out radar, 2026-11-11

- Always-on-top radar window around the live position with nearby pins and a tracked World Map target (direction, distance band, rim arrow); isolated preload/IPC; combat pauses details.
- App/lock, TOC and capture metadata align at 0.15.1 preview. **1.0 remains held.**

## 0.15.0 — World Map, in-game finder and Instance Atlas, 2026-11-11

- World Map page: original parchment cartography with the live arrow, trail and remembered paths; quest, flight, trainer, vendor, herb, ore and personal-find pins with clustering; "Near you"; cross-zone Find; waypoint copy.
- In-game `/bf find` (compiled offline finder, about 900 places) and `/bf way` native waypoints with super-tracking. Managed addon set is now fourteen files.
- Instance Atlas: classic-era baseline plus observed Forever encounters (bundled, CC BY 4.0), difficulty colours for your level, linked quests, entrance waypoints and a World Map deep link.
- App/lock, TOC and capture metadata align at 0.15.0 preview. **1.0 remains held.**

## 0.14.1 — first published tool-using AI and live game link preview, 2026-11-11

- Live-link UI check verifies the Companion side panel line by content, because narrow CI windows hide that panel. No app change. The unpublished 0.14.0 tag is preserved.
- App/lock, TOC and capture metadata align at 0.14.1 preview.

## 0.14.0 — tool-using AI and live game link, 2026-11-11

- AI questions can call seven bounded, read-only local lookups (NPCs, quests with objective NPC locations, items/vendors, travel, approved character, live state, waypoint command) across every provider transport, with a lookup trail on each answer. Models that reject tools get one plain retry on the same provider and model.
- Optional live game link: `/bf live on` draws a calibrated 40-cell status strip; the desktop reads only that strip (about 2 Hz) to know current position, facing, level, target, tracked quest, XP and bag space. Combat freezes details; protected client values stay unknown. No input, memory reads, screenshots or network.
- Verified in the real Forever client: fixed protected-value arithmetic and quest log return handling found during the hands-on check; added `/bf live status` diagnostics.
- Managed addon set is now thirteen files. New gates `test:companion-tools` and `test:live-link`. App/lock, TOC and capture metadata align at 0.14.0 preview. **1.0 remains held.**

## 0.13.7 — packaged validation shutdown and cleanup, 2026-11-11

- Preserve the unpublished 0.13.6 tag, notes and failed receipt. Its packaged application passed startup/restart, 133 reviewed byte matches, SDK loading and twelve-file addon install/readback/repair, then Windows blocked deletion of the disposable test executable.
- Wait for both application shutdown and the exact launched child process to close before restarting or removing the disposable packaged fixture. Revalidate its resolved TEMP parent and owned basename before copying/removing; no installed application or unrelated process is targeted.
- Retry transient Windows sharing/executable locks within one bounded removal budget, and keep stubborn locks or shutdown errors as test failures. The final packaged PASS line now prints only after successful cleanup; all functional acceptance assertions remain intact.
- Align app/lock, addon TOC, emitted capture and current documentation at 0.13.7 preview. No product behavior, dependency, data, game protocol, provider, audio or updater-trust changes beyond version metadata. **1.0 remains held for Frank's hands-on acceptance**; normal CI/build/publication and installed-updater proof remain separate gates.

## 0.13.6 — saved-character preview compatibility, 2026-11-11

- Restore read-only public context previews for an explicitly named stored character while another character is selected. The 0.13.5 candidate failed this existing Company backend contract during Windows validation and was not published; its tag, notes and failed receipts remain unchanged.
- Keep volatile location reports and the current question's report scoped to the selected character. Other-character previews show only that character's approved saved facts, without changing selection, conversation, memory or provider state. Null/omitted profile IDs still resolve to the selected character.
- Preserve strict current-character requirements for sending questions and using memory, the existing public-field allowlist, sharing opt-out and preview/send parity. Add a real-service regression covering retained and draft reports across both preview scopes.
- Carry forward local sourced NPC guidance, conservative current-location reports, cross-tier NPC identity reconciliation, complete-point city checks and connection timing fixes. No dependency, protocol, authentication, audio or update-trust change.
- App/lock, addon TOC, emitted capture and current documentation align at 0.13.6 preview. Windows CI, publication and authenticated installed-updater evidence remain separate gates; **1.0 remains held for Frank's hands-on acceptance**.

## 0.13.5 — local NPC guidance, current-location context and connection timing, 2026-11-11

- Keep Connection checks, optional activation and setup checks in the player's current open or closed state through status paints of the same screen. Preserve focused disclosure summaries; changing screen, character, setup session, folder or journal replacement retires the old choice.
- Bind setup navigation/Refresh checks to their exact physical renderer actions. Wait for the renamed plan's unique current card, exact new Delete label and natural Tab focus after the guarded paint.
- Answer recognized NPC names/IDs locally with compatible observed-build evidence first and a separately pinned CC BY 4.0 historical reference of 616 NPCs / 758 points. Keep build, per-NPC lastSeen and approximate/non-live qualifications; ambiguity and unavailable evidence never become guessed coordinates.
- Prioritize explicit current first-person player reports over old saved locations for AI planning, with shared preview/provider projection and bounded volatile scope. NPC city premises, quotes and historical memory do not report current location; sharing opt-out and cancellation stay intact.
- Preserve private journals, held-input ownership, write-count assertions and original timeouts. No dependency, game protocol, provider-authentication, audio or updater-trust changes. Existing quest data remains separately pinned.
- App/lock, addon TOC and emitted capture metadata align at 0.13.5 preview. Source preparation is not publication or installed-upgrade proof; **1.0 remains held for Frank's hands-on acceptance**.

## 0.13.4 — remaining preview validation and compact Party correction, 2026-11-11

- The 0.13.3 candidate passed voice validation, then failed before publication because the travel fixture expected assistant-history counts to grow across a deliberate sharing reset. Earlier failed tags, notes and evidence remain unchanged.
- Travel acceptance binds each actual main request and terminal result to its current renderer generation, prompt, profile, sharing choice and new reply/recovery identity. Support acceptance uses the current Adventure / Next step breadcrumb. No privacy, cancellation or ownership assertion was removed.
- Party keeps its first manual action inside the actual 984×635 viewport by compacting only its navigation/setup chrome. Existing artwork, role controls and readable labels remain; narrow native 200% layouts retain unclipped identity and scrollable actions.
- Audited all remaining source workflow commands from travel through character guidance; corrected the two concrete later blockers and retained their full gates. No dependency, data, schema, protocol, provider or updater-trust change.
- Package/lock, TOC and actual emitted capture are 0.13.4 preview. Installed 0.12.3 can update directly once published; 1.0 remains held for hands-on acceptance.

## 0.13.3 — Voice validation acknowledgement, 2026-11-11

- The 0.13.2 candidate passed Map validation, then failed the voice/memory smoke before publication. Its fixture released held readiness after a physical disclosure click before the queued native cancellation handler was acknowledged. All failed tags, historical notes and evidence remain unchanged.
- Voice smoke now observes native disclosure toggles, main cancellation and stopped state before releasing held readiness, then asserts exact speech-request, command and worker counts remain unchanged. Active/error folding, capability rejection and draft disclosure checks retain their privacy/cancellation assertions. Plan reading explicitly opens the existing folded quest-plan and Voice tools.
- The shared test navigation helper acknowledges native toggle delivery; fresh evidence folders preserve prior captures. No product renderer, audio service, dependency, data, schema, protocol or timeout change.
- Package/lock, TOC and emitted capture are aligned at 0.13.3 preview. Installed 0.12.3 can update directly once published; 1.0 remains held for hands-on acceptance.

## 0.13.2 — Map validation acknowledgement, 2026-11-11

- The 0.13.1 candidate passed the full unit suite, then failed the actual Map smoke gate before publication because the fixture read the dossier before its guarded paint completed. The 0.13.0/0.13.1 tags, historical notes and evidence remain unchanged.
- Map acceptance now waits for the exact selected public point ID, pressed controls, dossier title and evidence qualification. Pointer and keyboard actions select different points; the later older-reference click receives the same acknowledgement. Disclosure/profile checks also wait for their expected state. All thirteen gates and original assertions remain.
- Reproduced the old failure and passed the full isolated Map smoke with delayed real InteractionGuard callbacks. No renderer/product behavior, dependency, data, schema, protocol, recovery fixture or timeout changes.
- Aligned package/lock, addon TOC and actual emitted capture at 0.13.2 preview for the existing authenticated updater. Installed 0.12.3 can update directly once published; 1.0 remains held for hands-on acceptance.

## 0.13.1 — preview delivery correction, 2026-11-11

- The 0.13.0 candidate failed CI before publication. Its tag and evidence remain unchanged; this patch prepares the same reviewed features for the normal authenticated preview updater. Installed 0.12.3 can update directly once published.
- Corrected recovery fault-injection fixtures to use native Windows canonical paths, including genuine 8.3 temporary roots, with explicit proof that crash/promotion/cleanup injections execute. Production path guards and rollback/crash assertions remain unchanged.
- Replaced 140 full gathering-fixture replays with validated persisted history derived from an actual collected record plus real cap-crossing interactions. Exact 128 retention, oldest eviction, newest 64 export, deduplication, paused/unavailable login and clear remain checked; the 20-second deadline is unchanged.
- Aligned package/lock, TOC and emitted capture version at 0.13.1 preview. No product feature, dependency, data, schema, protocol or signing-trust change. 1.0 remains held for hands-on acceptance.

## 0.13.0 — installed Proactive Adventure preview, 2026-11-11

- Delivers the reviewed local series through the existing authenticated preview updater: proactive native/last-saved desktop Compass, one Professions workshop, native BF Layers and last-saved desktop Map, five-section sidebar, reliable conversation, sourced travel, diagnostics and recovery. Earlier local-review entries below remain historical evidence.
- Adds separate qualified acquisition/insights/travel references with explicit older-build, faction, partial-coverage and approximate-standing-point limits; no game automation, automatic AI or expanded sharing consent.
- Aligns package/lock, addon TOC and actual emitted capture version at 0.13.0. Setup/repair owns twelve files and preserves foreign files. No dependency, schema, protocol or game-build change.
- Requires acquisition validation plus Compass/Profession/Map acceptance in validation and tagged publication. Existing tests and Ed25519 updater trust remain required.
- 1.0 stays held. Real client rendering/gathering/performance, live providers/audio, clean-machine and actual installed upgrade acceptance remain separate owner checks. Publication and authenticated public-download results are recorded separately from this source preparation.

## Unreleased local review — proactive Compass, 2026-11-11

- Added local native and last-saved desktop recommendations for bags, quests, qualified craft attempts and observed profession rank caps, with independent Adventure/Quests/Professions goals.
- Added quiet signature-based native dismissal, guarded current-character callbacks and optional working quest details. Unknown, partial or stale material supply cannot claim readiness; individually valid learned recipes remain useful in partial observed catalogs.
- Added the sixth owned addon module with install/repair coverage, strict read-only desktop IPC and a graphical Adventure coach using existing art and five-section navigation.
- No capture/reference schema, public data pack, native command, provider or version change. Source remains 0.12.3; 1.0 and owner in-client acceptance are held. No release or installer was run.

## 0.12.3 — combined preview checkpoint, 2026-11-09

- Hardened idle fixture selection preparation against real refreshes replacing a previously resolved element. Original current-field text/focus/caret and intentional held-node checks remain; the 0.12.2 app release was cancelled before publication and its tag is preserved.

- Repaired the Quest Guide test's generic-heading wait so chain assertions follow the selected quest's completed detail. The 0.12.1 production workflow stopped before publication; its tag is also preserved.

- Corrected a Preparation retry test that inspected retained old material cards before the genuine read/paint completed. The focus assertion remains; delayed replies and newer deliberate focus receive explicit coverage.
- The 0.12.0 candidate was not published: its release was cancelled when a tag validation exposed this fixture race. Its tag is preserved. The combined public checkpoint is 0.12.3, with unchanged feature scope and update-signing trust.

- Delivered the Adventure Director, Preparation, optional Windows voice/private memory and Party milestones as one update, with 1.0 held for owner acceptance.
- Added an illustrated class/faction Quest Guide atlas, explicit reported chain links, observed reward and source-qualified destination panels, visible unknowns and readable compact controls.
- Refreshed compatible licensed Forever observations through November 9 and separately compiled historical seller facts with strict build/faction/date/partial-inventory qualifiers. Older same-build caches no longer hide a newer bundle.
- Added guarded map-specific/current quest-area observations, preserving direct points and clear area qualification without map-opening or gameplay input.
- Added deliberate portable plan preview/export/import, new manual unassigned imports and explicit selected-supply AI question drafts; no automatic sharing or inference.
- Preserved keyboard/native-control focus, drafts, queued saves and error ownership across source/character/navigation/reset/import changes. See the release notes and validation evidence for scope and measured limits.

## 0.11.0 — development milestone, 2026-11-09

- Added optional fixed local Windows speech, visible hold/release draft input, explicit reading/Stop and typed fallback with bounded process/protocol ownership.
- Added reviewed main-owned per-character saved exchanges, separate per-question selection/preview parity across providers, and memory exclusion from backups/replacement import.
- Preserved context, privacy and stale-effect boundaries; real microphone/voice quality remains owner-led acceptance. Delivered publicly with 0.12.


## 0.10.0 — development milestone, 2026-11-09

- Added a graphical Preparation workshop using observed owned professions, learned recipes and carried materials, with per-character recipe/batch preferences and source dates.
- Added exact shortfalls only for complete applicable bag observations; partial/unknown quantities remain explicit and other characters are never silently pooled.
- Added deliberate atomic manual shopping checklists in Company, without crafting, purchases, transfer or invented quest proof.
- Added guarded native collectors and dated caches, plus deep snapshot reload and both byte/node export budgeting that preserves collected characters before optional workshop detail.
- Preserved dirty input, held controls, native dropdown readability and compact navigation. Public delivery remains combined into the 0.12.3 checkpoint.


## 0.9.0 — development milestone, 2026-11-09

- Added explained Adventure Director choices and one-click tracked Company sessions, ranking all bounded eligible quests before the visible cap.
- Added native current-map/zone and level-aware ranking with factual reasons, qualified source labels and unknown-objective fallbacks.
- Preserved held mouse/keyboard/native-control actions and disclosure focus across queued updates with a shared renderer interaction guard.
- Private goals remain local; no automatic AI, gameplay actions or new reference data. Combined public delivery is the 0.12.3 checkpoint.


## 0.8.0 — 2026-11-09

- Added Company, a saved-character overview with source-labelled ready turn-ins, private goals and known preparation facts, preserving deliberate selection/follow behavior and class/faction artwork.
- Added local cross-character journeys and editable quest-session/dungeon-preparation checklists, with bounded migration, autosave, backup/restore and orphaned-character handling.
- Linked steps to observed saved quests and retained new compatible completion evidence without treating ready objectives, disappearance, historical repeatable completion or missing data as a new turn-in.
- Preserved private journey contents outside automatic AI context and protected game-owned evidence from ordinary form saves.
- Added a quiet live native bag-space cue from existing supported observations, with unavailable/zero-capacity, combat, character/session and layout guards. No gameplay automation, new data source or AI charge is introduced.

## 0.7.0 — 2026-11-09

- Added a bounded pure native quest planner and offline, source-labelled Lua reference compilation. Current out-of-combat game observations update native guidance without routine reloads or desktop AI.
- Expanded Adventure Compass with per-character focus/session preferences, compact current steps, explicit guarded waypoint action and reserved source/phase labels. Combat hides it; lifecycle generations prevent old timers or actions crossing character sessions.
- Prepared five managed addon files with staging/readback, module-first/loader-last commit and bounded application rollback; unrelated files remain untouched.
- Added runtime-aware setup and explicit validated client launch, safe unknown-status fallback, single-install automatic preparation and clear multiple/no-install choices. No initial desktop snapshot or AI connection is required to enter a prepared companion.
- Combined valid account exports with per-character timestamp guards, stable identity and partial/capacity reporting. Re-enabling following can apply the current connection's known saved active character immediately without a new save; private journals and deliberate selection remain protected.
- Clarified native live guidance versus last-saved desktop/AI context and removed routine level/zone reload nags. See docs/LIVING-COMPANION.md, docs/releases/0.7.0.md and docs/VALIDATION.md for activation, evidence and limits.

## 0.6.1 — 2026-11-09

- Gave native dropdown options explicit dark backgrounds, readable text and a clear selection state across the app.
- Repaired populated rosters with an empty active selection so the dashboard and character selector agree, preserving deliberate choices and follow preferences.
- Prevented pre-login addon events from overwriting a saved roster before restoration. Preserved the latest prepared export during logout and ignored teardown events until login; world entry refreshes observations.
- Added synthetic lifecycle/selection regressions for multi-character capture and complete saved progress. See docs/releases/0.6.1.md for activation and acceptance limits.

## 0.6.0 — 2026-11-09

- Added a bundled, separately licensed live-Forever reference pack with exact-ID/build lookup, reported quest links, NPC/objective observations, listed rewards and source provenance. Coverage is partial; reference-only cache records do not establish playability or every prerequisite.
- Added local Quest Guide and automatic reference enrichment for saved character plans. Supported complete completion-ID observations allow bounded follow-up candidates with explicit availability uncertainty. No AI connection is required for reference browsing or local planning.
- Added optional client build, locale, capture version and objective metadata through guarded public addon APIs. Completed quest ID sets remain local; all provider routes share a bounded approved reference context and matching preview.
- Added player-controlled numeric waypoint commands with build, quest-phase, combat and public-API checks. BF never moves, targets, fights, interacts, opens game maps automatically or forces a reload.
- Added cancellable build-specific public reference checks, offline bundled/last-good fallback, automatic-check controls and data attribution. Whole-build downloads send no character details.
- Fixed update recovery with bounded fresh retries, interrupted-stream handling, sanitized stage diagnostics, safe partial cleanup and Windows cache-path checks. Newer manifest failures no longer appear as up-to-date; verified older installers remain preserved. Retry and official Releases recovery stay available without weakening signature/hash/size checks.
- See docs/releases/0.6.0.md and docs/VALIDATION.md for release gates, measured results and remaining live-client/installed-upgrade limits.

## 0.5.0 — 2026-11-09

- Added deterministic source-backed observed-quest guidance, automatic plans and bounded session/focus selection without AI or invented routes.
- Added optional local equipped-item/bag-capacity snapshots with strict validation and graceful public-API failure handling; private journals and provider boundaries preserved.
- Added a character command center, per-character automatic planning preferences, compact status, expanded evidence, and class/faction visual polish. Removed the repeated successful-setup banner.
- Added fixed native capture diagnostics and real Electron command-center acceptance coverage. See docs/releases/0.5.0.md for scope and verification limits.

## 0.4.1 — 2026-11-08

- Made Adventure Compass use native WoW dialog artwork and close controls, title dragging, a separate collapse button, compact content sizing and visible hide/show instructions. Position/visibility/collapse persist per character after the updated saved-variable declaration loads.

- Fixed character capture aborting when public class/race/faction APIs return multiple values. This left Adventure Compass waiting and the desktop without a snapshot.
- Lua runtime tests now use realistic multi-return player APIs and reject interpreter stderr even when the interpreter reports exit status zero.

## 0.4.0 — 2026-11-08

- Added first-run/migration companion setup, bounded Forever discovery and fallback folder selection, automatic three-file addon preparation/readback/repair, clear phases and next actions.
- Fixed packaged addon resource placement after a shipped-bundle regression escaped source-only tests; packaged installation/readback is now a required release check.
- Added a local quest/objective/ready-turn-in/XP dashboard and optional draggable/collapsible in-game Adventure Compass, hidden during combat. Desktop snapshots still require voluntary reload/logout.
- Added actual public-API waypoints, up to 25 observed recent turn-ins and optional bounded completed-count; no complete historical quest-name or optimal-route claims.
- Expanded bounded approved public AI context with preview/opt-out; private notes/goals/identifiers stay excluded. Public game race/faction are accepted independently without a fixed race whitelist.
- Added automatic settings/model/profile/note saving, encrypted key saving on blur, retryable status, Enter-to-send and Shift+Enter newline with composition handling. No background inference.
- Added sculpted SVG/CSS controls, gems/runes, ambient motion and reduced-motion/hidden-window handling while retaining original artwork.
- Preserved schema-version-1 optional-field compatibility, stable character edit targets and journals across snapshot imports. Added setup/autosave checks to CI. See docs/releases/0.4.0.md and docs/VALIDATION.md for evidence and limits.

## 0.3.0 preview — 2026-11-08

- Added optional Game Connection with guarded one-click addon installation and five-second saved-snapshot checks. WoW saves on `/reload` or logout, not continuously. Imported roster updates preserve notes/goals; only visited characters are known.
- Added last-played following by default; deliberate profile selection pauses following until re-enabled.
- Added provider/auth-specific model discovery and separate Ollama Cloud native chat with its own key. Catalog requests do not run inference or prove every plan entitlement; failures preserve the selection without paid fallback.
- Made the companion a permanent WoW Forever specialist with local off-topic gating, shared provider policy, saved-context preview and persistent opt-out. Public active-character context now defaults on; private notes/goals and source identifiers remain excluded.
- Expanded graphical roster and planning presentation with nine original class portraits and Alliance/Horde environments, with neutral fallback.
- Retained signed automatic update integrity. Windows Authenticode, real-game acceptance and live subscription acceptance remain separate gates. This entry records implementation, not publication.

## 0.2.0 — 2026-11-08

- Original painted fantasy scenery, dimensional companion medallion, bronze/leather frames, parchment journal and bundled Cinzel/Source Sans 3 typography.
- Automatic authenticated Windows release checks/downloads, install-on-exit, restart-now, manual checks and persistent preferences. Source builds never automatically check or execute installers; 0.1.0 requires one manual upgrade.
- Pinned Ed25519 update manifests, SHA256/size and repository/version binding, bounded downloads, cache revalidation, cancellation/reset protection and tag-triggered signed release publication.
- Updater, signing and UI preference tests; existing profile and provider privacy defaults preserved.
- Clarified Grok inference-isolation work and next acceptance/model-discovery/addon milestones.

## 0.1.0 preview — 2026-11-08

- Introduced Backstage Forever from Backstage Coding, designed by Frank Arena.
- Added a Windows desktop foundation for manually maintained characters, goals and notes, optional AI, provider settings and local data controls.
- Added Ollama, OpenAI, Anthropic and xAI adapter protocols with fixture-based verification; no live cloud certification is claimed.
- Added an experimental out-of-combat manual-copy addon prototype with a required verified interface placeholder. No game files were installed or changed.
- Added beginner setup, provider, privacy, compatibility and manual release instructions.

Preview limitations: unsigned installer and clean-machine/upgrade checks pending; Frank confirmed the public MIT repository farena-ai/Backstage-Forever; addon client/API compatibility unverified; no live bridge or automatic updater. See docs/VALIDATION.md for measured results rather than treating this feature list as an acceptance certificate.

- Added explicit ChatGPT browser subscription authentication and an app-private official Claude Code subscription transport with fixture tests. Real consent/inference acceptance remains pending; xAI API is available while Grok subscription tools/hooks isolation is reviewed.

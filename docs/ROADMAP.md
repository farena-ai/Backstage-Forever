# Backstage Forever roadmap

**Current planning:** Start with the [post-1.12 delivery order](FOREVER-COMPANION-NEXT-ROADMAP.md#post-112-delivery-order), the [Academy, Fieldbook and Guild backlog](ACADEMY-FIELDBOOK-GUILD-BACKLOG.md), and the [broader expansion backlog](FOREVER-EXPANSION-BACKLOG.md). The existing [All-in-One roadmap](ALL-IN-ONE-ROADMAP.md) carries the broader delivery and live validation gates. The historical suggestion below for open-web lookups through providers is superseded by the current Forever-only evidence rules.

Where the companion goes next. Written 2026-11-12, after 0.20.0; updated 2026-11-13 after 0.25.0 (Tier 2.6 best-addon features, Tier G graphics program). Ordered by value to a player: a beginner should feel guided, and a veteran should feel faster.

**Sizes:** S = a day or less · M = a few days · L = a week or more · XL = a multi-release program.
**Where:** Game = the addon · App = the desktop app · Both.

**Ground rules for every item:**
- Public WoW API only.
- No automated game input.
- No paid services.
- Game art is read locally, never bundled.
- Horde and Alliance get equal coverage.
- Every new command or helper goes on Help → Commands; a test enforces it.
- **Information is the lifeline.** Every place the app names a quest, NPC, item, zone or step should lead to the richest, most visual detail we can source. Every "Show on map" or "Open" link should land on exactly the thing you asked about.

---

## Shipped so far (0.16 – 0.20)

- **Live link:** follows you in real time, including over remote access (0.18.2).
- **Now page:**
  - Do this next, where to level, training, quest log.
  - Get set up checklist.
  - This session card: XP pace, rested, deaths.
  - Level-up celebration.
- **World Map:**
  - Distinct icons.
  - NPC cards with quests and training.
  - Your path this session.
- **In game:**
  - BF Guide layer on the world map.
  - `/bf next`, `/bf train`, `/bf find`, `/bf xp`, `/bf hearth`.
  - Danger warnings, death help with an arrow to your body.
  - Level-up and quest pop-ups, Sell junk button.
- **Alliance coverage:** four game builds merged (0.20.0).
- **Help:** Field guide with glossary; Help → Commands.
- **0.21.0:**
  - Repair reminder and `/bf repair`.
  - Flight path tracking and `/bf flights`.
  - Alliance vendors.
  - A `/reload` prompt.
  - Art pass 1.
  - Two flaky checks fixed.
  - This finished roadmap items 1.1, 1.2, 1.4, 1.6 and 1.8 and graphics step 1.

---

## Tier 1 — Quick wins (next 1–2 releases)

| # | Feature | Size | Where | Why it matters |
|---|---|---|---|---|
| 1.3 | **Grey-quest cleanup.** Flag quests in your log that no longer give much XP, with a one-line "safe to abandon" hint. Hint only; never auto-abandon. **Done in 0.23.** | S | Both | Full quest logs confuse beginners. |
| 1.5 | **Helper switches in the app.** Settings → Game shows the in-game helpers (pop-ups, danger, Sell junk, live strip) and how to toggle them. **Done in 0.23.** | S | App | Discoverability. |
| 1.9 | **Verify live link over remote access** in a real remote session, and add a capture-based regression test. **Partly done in 0.18.2 and 0.32:** capture-based tests and /bf live safe exist. **After 1.0:** one check in a real remote session is still to do. | S | Both | Confirms 0.18.2 in your actual setup. |

## Tier 1.5 — Depth and focus (Frank's priority, start in 0.22)

These come from hands-on use. Clicking through from Now must take you straight to the answer, and the answer must be complete.

| # | Feature | Size | Where | Why it matters |
|---|---|---|---|---|
| D1 | **Dialed-in "Show on map".** Every link from Do this next, Where to level, training, the quest log and NPC cards opens the map in a focus mode: zoomed to that one target, with other pins dimmed, a line from you to it with distance and direction, and a "what to do here" card (talk to X, kill 6 of Y around here, hand in to Z). For multi-step targets it shows the steps in order. One click returns to the full map. **Done in 0.22.** | M | App | Today the map opens near the target but doesn't show what to do there. |
| D2 | **Link audit.** Every clickable reference across Now, Quests, World Map, Characters and Commands is checked to open the specific thing. Each gets an automated test that clicks it and asserts the focused target. **Done in 0.22 and 0.31.** | S–M | App | No link should land on a generic page. |
| D3 | **Rich quest pages.** Objectives with where to do each one (mini map), giver and turn-in with mini maps, level and required level, the chain (previous/next quest), and full **rewards**: item names, quality colours, stats and icons, plus "upgrade for you?", money, XP at your level and reputation. Graphical layout, not a list. **Done in 0.22 and 0.23.** | M–L | App | "Open quest" currently shows objectives but little about rewards. |
| D4 | **Keep everything the community data already has.** Today we drop quest money, reputation, XP difficulty (which gives real XP at your level) and reward spells. 1,456 quests have item rewards, but only 274 have every reward item named. Import those fields and resolve every item name. **Done in 0.22.** | S–M | App | Quick, large gain in detail. |
| D5 | **Read item, spell and creature details from your own game install.** Item stats, quality, icons, sell price and required level; spell names and icons; creature levels and elite flags. Read locally at runtime from your WoW Forever files, the same way the map art is today, and never bundled or uploaded. This powers D3, the reward picker (2.1), gear hints (2.2) and enemy levels (2.5). **Done in 0.23.** | L | App | The richest, most accurate source, and always matches your build. |
| D6 | **Data coverage view.** A small Help page listing how much we know per zone and per faction (quest givers, objectives, trainers, vendors), where data is thin, and when it last refreshed. **Done in 0.23.** | S | App | Honest about gaps; guides where to improve. |
| D7 | **Visual consistency for detail cards.** Quest, NPC, item and zone cards share one visual system: portrait or crest, colour-coded chips, icons and mini maps. This is art pass 2's companion work. **Done in 0.30 and 0.31.** | M | App | Keeps "lots of information" beautiful rather than busy. |

## Tier 1.6 — Quest intel: "how do I actually do this?" (top priority, 0.24)

From play: on "That Shadowvale Green Elixir" the companion knew where to go but not how. Are the bottles dropped by enemies or lying in the ruins? A web search answered it at once. The answer was in the quest's own text ("Travel to the ruins of Shadowvale... recover some bottles"), which the app never had. Every quest should get a plain **How to do it**.

| # | Feature | Size | Where | Why it matters |
|---|---|---|---|---|
| Q1 | **Your quest log's full text.** The addon saves the description and objectives of quests in your log (your own data, kept locally). Quest pages show them, and the companion reads them. **Done in 0.24.** | S–M | Both | The quest text often says exactly what to do and where. |
| Q2 | **Learn item sources from your own play.** When you loot a quest item, the addon notes whether it came from a creature or an object, and which one and where. The app then says "found in crates and bottles in the ruins" or "dropped by Rot Hide Gnolls". **Done in 0.24.** | M | Both | Covers Forever-only quests that no shared data knows. |
| Q3 | **Community drop data.** Use the shared loot and object datasets: "dropped by Southsea Brigand (31%)", "loot from Food Crate objects". **Done in 0.24.** | M | App | Most classic quests are covered. |
| Q4 | **How to do it box.** Built from objective type (kill / collect from enemies / pick up objects / use an item / talk / explore), the item sources, the area, levels and elites, plus the quest text. It shows on quest pages, Now and the map's goal card. **Done in 0.24.** | M | App | One clear answer instead of guesswork. |
| Q5 | **Smarter companion answers.** The companion gets tools for quest text and item sources. When local knowledge is thin, it can do an opt-in web lookup through your own AI provider, with sources cited. **Partly done in 0.24:** the companion has quest and item tools. **After 1.0:** the opt-in web lookup. **0.58:** the companion understands everyday phrasing and answers from Forever's data (people, jobs, trainers, vendors, drops, quests, dungeons, transports), with a 100-question benchmark: 15% → 97% covered. | M | App | Matches what a quick web search gives, inside the app. |
| Q6 | **`/bf how` in game.** The How to do it answer for your tracked or nearest quest, in chat. **Done in 0.24.** | S | Game | Answer without alt-tabbing. |

## Tier 1.7 — Always current, without /reload

Frank asked whether Refresh on Now could do the `/reload` itself. It can't: the app never sends keys or commands to the game. That would be game automation, which Backstage Forever doesn't do and Blizzard's rules forbid. What we can do is make reloads unnecessary for staying current:

| # | Feature | Size | Where | Why it matters |
|---|---|---|---|---|
| R1 | **Live strip v4 with pages.** The strip cycles through extra pages a few times per second: the quest log (ids and completion), objective progress counts, money, bag space, equipped item ids. Now, the quest log and the gear review then update while you play, with no `/reload` needed. Saved files still fill in the rest at logout. **Done in 0.25.** | M–L | Both | Now never falls behind during play. |
| R2 | **Clear freshness.** Each Now card shows whether it is live or from your last save, and when that save was. Refresh re-reads the save and live state at once. **Done in 0.25.** | S | App | You can see at a glance what's current. |
| R3 | **Smarter update timing.** After an app update, the reload banner names the exact moment the new addon landed, so a reload done a few seconds too early is obvious. | S | App | Removes "I reloaded but it's still there". |

## Tier 1.8 — A free companion for everyone, one click to start

Frank asked for a companion that costs players nothing, and it must be **one click to install and super easy to get running**: no accounts, no terminals, no separate installs. Backstage Forever won't host an AI service itself (that would be a paid service run by us). The plan:

| # | Feature | Size | Where | Why it matters |
|---|---|---|---|---|
| F1 | **Quick answers, zero setup.** Always on, with nothing to install: the most common questions are answered instantly from the app's own knowledge ("how do I do this quest", "where is X", "what should I do next", "what do I train", "how do I get to Y"). Works offline. NPC and travel answers already work this way; this extends it to quests, how-to, training and next steps. **Done in 0.25.** | M | App | Every player has a useful companion from the first launch. |
| F2 | **"Turn on free AI": one click.** A single button in the Companion. The app checks the PC, downloads a small free model that suits it (a progress bar, about 2–5 GB, resumable), and runs it with a local AI engine built into the app. Then it says "Ready" and the chat just works. No Ollama, no account, no key, and nothing leaves the PC. It includes a one-click remove that frees the disk space. **Done in 0.27.** | L | App | The free, private, full AI companion, as easy as installing an app. |
| F3 | **Slow PC? Free cloud option, guided.** If the PC can't run a local model well, the same button offers a free hosted tier instead (for example Google's Gemini API or Groq), opening the provider's own page to get a free key and pasting it back automatically where possible. The app is upfront about rate limits and that some free tiers may use questions for training. **Done in 0.27.** | M | App | A free option for every computer. |
| F4 | **Advanced: Ollama and paid providers.** These stay available in Settings for players who already use them; they're no longer the main path. **Done in 0.14 (kept since).** | S | App | Nothing is taken away. |

## Tier 1.9 — Now page fixes (Frank's report, 0.25)

| # | Fix | Size | Where | Why it matters |
|---|---|---|---|---|
| N1 | **Done is done.** Quests this character has already turned in never show up as something to pick up or do. If a finished quest has to appear (a chain, a hand-in history), it wears a clear green **Completed** tag and is dimmed. The completed list comes from the addon's saved quest history, plus the live strip once R1 lands. | S–M | Both | Old quests on Now confuse players about what's left. |
| N2 | **Tidy right column.** Fix the odd gap between the two boxes in Now's centre-right column, so the cards stack evenly at every window size. A layout check in the Now test keeps it from coming back. **Done in 0.25.** | S | App | A neat page reads at a glance. |
| N3 | **Sidebar fits on open.** At the default window size, the top seven links on the left menu fit without a scroll bar. That means tighter spacing, a compact header, and the scroll area starting below the main links. **Done in 0.25.** | S | App | The first thing a new player sees shouldn't need scrolling. |

## Tier 2 — Core guidance upgrades (next 2–4 releases)

| # | Feature | Size | Where | Why it matters |
|---|---|---|---|---|
| 2.1 | **Quest reward picker.** On the reward screen, highlight the best choice for your class and spec using public item stats, with a short reason ("+3 Agility, an upgrade over your Ragged Leather Vest"). The player still clicks. **Done in 0.23.** | M | Game | One of the most-loved features of leveling addons; beginners guess badly. |
| 2.2 | **Gear upgrade hints.** "This is an upgrade" on items in bags and from vendors, using the same scoring. The app's Characters page lists weakest slots and where to fix them (quest rewards, vendors, dungeon drops). **Done in 0.23 and 0.24.** | M | Both | Turns loot into decisions. |
| 2.3 | **Zone route stepper.** An ordered plan per quest hub: pick up these, do objectives in this order, hand in here. `/bf route` and a compact in-game step frame tick off steps from quest events. Built from our quest, giver and objective data. **Done in 0.26.** | L | Both | The real "tell me exactly what to do" experience. |
| 2.4 | **Objective areas on the map.** Shade where kill and collect objectives happen. Learn from your own play: record where objective progress ticks, locally, and merge with community data. **Done in 0.24.** | M | Both | "Where do I find 8 Plainstriders?" is the #1 beginner question. |
| 2.5 | **Enemy levels on the map.** Show level ranges and elite camps per zone from creature data, colored the way the game colors levels. **Done in 0.24.** | M | App | Avoids wandering into red zones. |
| 2.6 | **Talent coach.** Per-class leveling talent suggestions (solo-friendly builds we write ourselves), with a "spend your point" reminder on level-up. Talent data is read from the local client. **Done in 0.23.** | M–L | Both | Talents are confusing at level 10. |
| 2.7 | **Dungeon readiness.** For each dungeon: the right level band, quests to pick up first and where, what to bring, and a "you're ready" check against your level and gear. **Done in 0.24.** | M | App | Dungeons are where new players get lost or underprepared. |
| 2.8 | **Profession leveling helper.** Skill-up color for each recipe (orange/yellow/green), the cheapest next recipe, a materials shopping list, and gathering routes from the find index. **Done in 0.30.** | M–L | Both | Professions are a maze without guidance. |
| 2.9 | **Hearthstone advice.** "Your hearth is in Razor Hill, but your quests are in the Barrens. Set it at the Crossroads inn." **Done in 0.23.** | S | Both | Saves long runs. |

## Tier 2.5 — Everything about where you are and what you can do

The goal: open the app (or type `/bf`) and know everything useful about your spot in the world, as pictures first and words second. Every item is one click, needs no setup, and covers Horde and Alliance equally.

| # | Feature | Size | Where | Why it matters |
|---|---|---|---|---|
| E1 | **Zone briefing.** A "You are here" card for the current zone: level band, quest hubs and how many quests are open to you, flight master, inn, trainers for your class and professions, repair and ammo/food vendors, dangerous elites and rares, and herb/ore/fishing spots. Each one opens the map dialed in on it. **Done in 0.26.** | M | App | One glance answers "what's around me?" |
| E2 | **Shopping and supplies.** Knows your class: arrows/bullets, food and water at the right level, reagents, poisons, soul shards. Says when you're running low and the nearest vendor that sells them. **Done in 0.27.** | M | Both | Running out mid-quest is a classic beginner trap. |
| E3 | **Trainer planner.** What you'll learn at the next trainer visits, what it costs, and whether you can afford it, along with weapon skill trainers worth visiting. **Partly done in 0.27:** the next three training levels with spell icons. **After 1.0:** costs and weapon trainers (no cost data yet). | S–M | Both | No surprise trips back to town. |
| E4 | **Mount and gold goals.** *(Done in 0.36: a gold goal you set yourself on Gold & prices, progress across characters, days left from the addon's daily gold log. Still to do: suggested riding and mount costs (no trainer or mount prices in the bundled data) and what to sell.)* A savings tracker for the level 40 mount (and later epic mount): gold per hour this week, whether you're on pace, and which grey items or crafts to sell. | M | App | The biggest money goal in leveling, made visible. |
| E5 | **Class quest chains and key unlocks.** *(Not started: the bundled quest data has race masks and next-quest links but no class restrictions, so class quests can't be told apart without hand-written lists.)* Class quests, weapon and totem quests, pets, forms, dungeon attunements: when they open, where they start, and the full chain on one page with steps and rewards. **After 1.0** (the bundled quest data has no class restrictions). | L | App | These are easy to miss and hard to piece together. |
| E6 | **Reputation and factions.** *(0.35: where each character stands, plus profession cooldowns, is done on Ledger → Reputation and Cooldowns; the turn-in advice and unlocks are still to do.)* Where your reputations stand, the fastest quests and turn-ins to raise them, and what each standing unlocks. | M | App | Rewards most players never notice. |
| E7 | **Death review.** After a death: what killed you (from the combat log your addon already sees), its level and elite status, and one plain tip. **Done in 0.29 and 0.33.** | M | Game | Turns deaths into lessons, not frustration. |
| E8 | **Professions, deep.** Building on 2.8: recipe trainers and vendor recipes on the map, gathering routes for your skill level, what to craft for profit or for your own gear, and a skill-up countdown. **Partly done in 0.30:** skill-up colours, next recipe and shopping list. **After 1.0:** gathering routes, profit advice and recipe sources on the map. | L | Both | "Essentially everything" for professions. |
| E9 | **Rested and play-time planner.** Rested XP, where to log off (inn or city), and how many levels tonight's session should give you. **Done in 0.28 and 0.47.** | S | Both | Small, satisfying, and very useful. |
| E10 | **One-click setup, all the way.** The first launch finds WoW automatically, installs and updates the addon, turns on the live link, and checks everything with green ticks. No folders, no files, no terminals. Problems are fixed with a "Fix it" button, not instructions. **Partly done in 0.25:** Set it all up and the checklist. **After 1.0:** a Fix it button per problem. | M | App | Super easy for every player, from the first minute. |
| E11 | **Info everywhere.** Hover any quest, NPC, item, zone or spell anywhere in the app to get a rich card (icon, level, where, rewards, who drops it), consistent across pages (the D7 card system). **Partly done in 0.29 and 0.30:** hover cards for quests, items and NPCs. **After 1.0:** cards for zones and spells. | M–L | App | Information is the lifeline. |
| E12 | **Over-the-top extras.** Animated zone arrival banners in the app, a level-up replay reel for the session, a "story so far" chapter page per character with zone art, and achievement-style badges painted locally with ComfyUI. **Partly done in 0.26 and 0.28:** zone arrival banners and painted badges. **After 1.0:** the level-up replay reel and the story-so-far page. | M per item | App | Fun keeps people playing. |

## Tier 2.6 — What the best addons do, built into one companion

Players today stitch together a dozen addons. Each item below takes what players love about a well-known *kind* of addon and builds it into Backstage Forever. It's our own design, public WoW API only and free, and it works together with Now, the map and the companion. Wherever a player already runs one of these addons, we stay out of its way.

| # | Feature | Like… | Size | Where | Why players want it |
|---|---|---|---|---|---|
| A1 | **Quest objectives everywhere.** Mobs and objects you need show a small icon over their heads and a "3/8 Bottle" line in their tooltip. Objective areas glow on the world map and minimap. **Partly done in 0.26:** quest progress in enemy tooltips. **After 1.0:** overhead icons, object tooltips and the glow on the in-game map. | Quest-helper addons | M–L | Game | The most-installed kind of leveling addon: you never wonder "is this the right mob?" |
| A2 | **Step-by-step guide with an arrow.** One step at a time in a small frame ("Accept Raptor Thieves", "Kill raptors here", "Turn in at Gazrog"), with an arrow pointing to it. It ticks off from quest events and skips what you've already done. This is 2.3 and 4.1 in game form. | Leveling-guide addons | L–XL | Both | The #1 reason players buy leveling guides. Ours is free, for both factions, and built from real data. |
| A3 | **Speed splits.** Time per level against your own best and against your other characters, a pace line on Now, and "you're 12 minutes ahead" at each level-up. **Partly done in 0.28:** speed splits on Characters → Journey. **After 1.0:** the pace line on Now and minutes ahead at level-up. | Speed-leveling guides | M | Both | Experienced players love racing their own records. |
| A4 | **Dungeon loot browser.** Every boss's drops with icons and stats. "Upgrade for you" badges, a wish list, and a "this dungeon has 3 upgrades for you" score on dungeon cards. **Done in 0.30.** | Loot-browser addons | M–L | App | The first thing players check before a dungeon. |
| A5 | **Boss tips.** Short plain-words tips per boss ("interrupt the heal", "kill the adds first") shown when you target the boss, plus a pull checklist. Text, not timers. **After 1.0** (not built yet). | Boss-warning addons | M | Both | New players wipe less, and veterans get reminders. |
| A6 | **Gathering memory.** Every herb, ore and chest you open is remembered with its spot. The app shows a heat map per zone, and the in-game map shows remembered nodes, with routes for your skill level (feeds E8). **Partly done in 0.30:** 500 remembered spots, the heat map and /bf nodes. **After 1.0:** spots on the in-game map and skill-level routes. | Gathering-map addons | M | Both | Turns gathering from wandering into a route. |
| A7 | **Price memory.** *(Done in 0.35: Gold & prices and item cards; vendor prices and bag flags still to do.)* When you browse the Auction House yourself, the addon remembers the prices it saw. Tooltips then show "about 1g 20s at auction" and "vendor for 35s", and bags flag what's worth selling. There are no automated scans or buying; it reads only pages you open. | Auction helper addons | M–L | Both | Gold matters for training and the mount (E4). |
| A8 | **Session stats.** Damage and healing per fight from your own combat log, a "best fight" card, and kills, deaths and gold earned per session on Now. **Done in 0.29.** | Damage-meter addons | M | Both | Fun numbers, and they help tune talents. |
| A9 | **Hunter, warlock and rogue helpers.** Pet happiness and feeding reminders, ammo and soul shard counters, poison reminders and class-quest alerts (E5). **Done in 0.27.** | Class helper addons | S–M | Game | Small, constant help that classes need. |
| A10 | *(Done in 0.40: top-of-screen alert and chat line, once per player every 5 minutes, never in battlegrounds; `/bf enemy` history of 20, sound off by default.)* **Enemy player alerts (PvP servers).** "Alliance level 32 rogue nearby" from targets and nameplates you see, with a short history. Public data only. | PvP alert addons | M | Game | Safety on contested ground; Horde and Alliance alike. |
| A11 | *(Done in 0.41: `/bf qol` coords, faster auto-loot, dismount at flight masters and instant quest text, each off by default. Dismount still to check in the real client.)* **Quality of life pack.** Sell junk and repair (done), plus: skip quest dialog text you've already read, an auto-dismount option for flight masters, a faster loot window and a coordinates readout. Each one is off by default and switched on with `/bf`. | QoL bundle addons | S each | Game | The little things players expect. |
| A12 | **Gear sets.** *(Done in 0.36: `/bf set save|wear|list|delete`, worn from bags only and never in combat; the Sheet page shows each set's score and where missing pieces are. One-click button in game still to do.)* Save and swap sets (leveling, gathering, dungeon) with one click outside combat. The app shows each set's score. | Gear-set addons | M | Both | Swapping gear by hand is tedious. |
| A13 | *(Done in 0.42: `/bf party` who needs what, shared waypoints with `/bf party way|go`. Still to check with two real players.)* **Social and party.** Party members running the addon see each other's quest needs (3.6), a "who needs what" list, and shared waypoints. | Party-sync addons | L | Both | Grouping goes smoother. |
| A14 | **Unified tooltip.** One rich tooltip in game and in the app, built from everything above: quest use, drop sources, price, upgrade, who sells it. **Partly done in 0.29 and 0.30:** hover cards in the app and the upgrade line in game. **After 1.0:** price, drop and quest use in the game tooltip. | Tooltip addons | M | Both | Information is the lifeline. |
| A15 | **Ask the companion from inside the game.** *(Asked for by Frank, 2026-11-14; answer panel over the game approved. Built in 0.38: owl button on the minimap (drag around the edge, `/bf ask hide|show`), question box and `/bf ask QUESTION`, up to 200 characters, sent only on Ask/Enter and never in combat (it waits, Cancel drops it); question pages on the live strip (17 bytes a page, bursts of four 0.4s pages between ordinary pages, two passes: a 200-character question takes about 7s); answers through the Companion's own path in an always-on-top panel at the top-right of the game window that never takes the keyboard, also kept in the Companion conversation; Settings → Game connection switch and hide time. Still to check in the real client: strip speed and reliability, the panel over borderless full screen, the button art and drag. **0.39.1, one window** (asked for by Frank, 2026-11-14: question and answer in the same window): the owl sends only an "open" signal and the question is typed in the panel itself, answers stack under their questions, Esc closes; the in-game question box is gone.)* A small painted button on the minimap (drag it around the edge, `/bf ask` too) opens a question box in game. Addons cannot reach the internet, so the question travels to the desktop app over the live strip (a short text page, sent only when you press Ask, never in combat), the app asks the AI you chose (or answers offline from the bundled reference for where/how questions), and the answer appears in a small always-on-top panel over the corner of your game (the 3.4 mini window), so you never leave WoW. The game cannot receive the answer itself; the panel is the app's own window. Before building: test in the real client that the strip can carry the text quickly and that the panel works over a full-screen game. | Questie-style minimap buttons, AI helpers | M–L | Both | Help right where you play, without alt-tabbing. |

**Rules for this tier:**
- These are original designs, not copies.
- Public API only, and nothing done for the player: no automated buying, no automated quest accepting, nothing in combat that the game doesn't allow.
- Each feature is switchable on Help → Commands and in Settings.

## Tier G — The graphics program: heavily graphical and impressive

Backstage Forever should look like a premium fantasy companion on every page. All art is original and made locally with ComfyUI (native 2K, upscaled where needed). Nothing imitates Blizzard art, characters, logos or landmarks. Each pass adds to one shared style guide so the whole app stays consistent.

| # | Item | Size | What players see |
|---|---|---|---|
| G1 | **Living heroes.** Page headers become short, looping painted scenes: drifting clouds, embers, water shimmer. These are layered parallax stills (ComfyUI layers) with optional tiny video loops, and they're off in reduced-motion mode. **Done in 0.27 and 0.31.** | M | The app feels alive on first open. |
| G2 | **Zone arrival banners.** A painted vista and the zone name sweep in when you enter a new zone (app and in-game toast), with the zone's level band and quest count. **Done in 0.26 and 0.37.** | M | Every new zone feels like an arrival. |
| G3 | **Painted map pins and legend.** Every World Map pin kind gets its own painted icon (giver, hand-in, trainer, flight, vendor, herb, ore, elite, rare, dungeon), with hover glow and animated focus rings. **Done in 0.26.** | M | The map reads at a glance and looks crafted. |
| G4 | **Animated routes.** Route lines on the map flow toward the next step, with footprints for your journey and a pulsing target. **Partly done in 0.26:** a dashed route and trail dots. **After 1.0:** the flowing animation, footprints and pulsing target. | S–M | You can see where to go next. |
| G5 | **Character sheet.** *(First part in 0.36: Characters → Sheet paper doll with quality colours, item level, empty slots, upgrade hints, stats and gear sets. Painted portraits done in 0.58: one per race, sex and class, including the Skyborne races. The talent tree view still to do.)* A full-page painted portrait per class and race (original art), with gear slots drawn around it like a paper doll, glowing upgrades, and a talent tree view. | L | The page players will screenshot. |
| G6 | **Dungeon and boss art.** A painted card per dungeon (original scenes inspired by each dungeon's theme), boss silhouettes, and loot shown on velvet trays. **Partly done in 0.58:** a painted card for every one of the 27 dungeons and raids. **After 1.0:** boss silhouettes and loot on velvet trays. | L | Dungeons feel epic before you even zone in. |
| G7 | **Badges and milestones.** A full set of painted badges for levels, firsts, zones completed, professions and speed splits, with a badge wall on Characters. **Done in 0.28.** | M | Collecting keeps people playing. |
| G8 | **Celebrations, part 2.** Level-up, quest-chain completion, dungeon clear and new mount moments, each with its own animation and sound. **Partly done in 0.22.1 and 0.33:** the big level-up with sound and animated chain and dungeon moments. **After 1.0:** their sounds and the mount moment. | M | Big moments feel big. |
| G9 | *(Done: toasts by G13 and G14 in 0.37 and 0.39; the Adventure Compass and step frame painted in 0.49, samples approved by Frank 2026-11-14.)* **In-game frames reskin.** The Adventure Compass, step frame and toasts get painted frames that match the app, and stay readable and small. | M | One look, in game and out. |
| G10 | *(Done in 0.49: painted splash and a three-card welcome tour for new players, replayable from Help → Field guide.)* **Splash and onboarding.** A short cinematic first-launch splash and a three-card painted tour for new players. | S–M | A great first impression. |
| G11 | *(Done in 0.49: Horde and Alliance crests on the brand and every page banner, with matching colour sets.)* **Faction themes.** Horde and Alliance colour sets, crests and ornaments that switch with your character, equal in quality. | M | Alliance is just as important. |
| G12 | **Art review before 1.0.** One pass over every page against the style guide: spacing, contrast, motion and dark-room readability. **Done in 0.54:** `docs/STYLE-GUIDE.md`, AA colours and an 11px minimum (part 1), then every page captured in English and German and checked by eye and by `scripts/dev-preview-pages.cjs` (stray button ornaments, dark text on dark buttons, cramped buttons, spilling or clipped text, small text). Fixed: unreadable Zones tiles, wrong dungeon pick-up quests, stray ornaments on dungeon cards, gear cards in plain words, readable save dates, a menu that fits laptop screens. | M | Polish everywhere. |
| G13 | **Painted in-game zone banners, one per zone.** *(Asked for by Frank, 2026-11-14.)* The in-game arrival banner (today a see-through black box with the zone name in yellow and its level range) becomes a solid painted banner at the same size (560×74): its own original painting for every zone and capital (Durotar's red canyons, Elwynn's meadows, Tanaris's dunes and so on), the zone name in a carved title and the level range and quests on a painted ribbon, Alliance and Horde zones alike. Zones without their own painting yet use the matching landscape type (desert, snow, swamp, forest…). Original art from local ComfyUI, shipped as addon textures; the same painting heads the zone card in the app, so game and app match. Quiet in combat, as today. | M–L | Entering a new zone feels like an event, in game and in the app. |
| G14 | **Painted in-game message banners, every one.** *(Asked for by Frank, 2026-11-14: "everything to have a graphic … for consistency".)* Every message box the addon shows in game (today a see-through black box with a yellow title) becomes a solid painted banner in the same style as the G13 zone banners: its own original painting per kind of message, the title in gold and the text on a ribbon. Kinds: flight master nearby, quest complete, level up, you died, run back to your body, back on your feet, gear wearing out / broken, move your Hearthstone, ready (first login), the journey firsts (first dungeon, flight, mount, death, rested, group, hearth), and the kill and profession moments (elite, rare, boss, dungeon cleared, profession milestone). Same size and placement as today, quiet in combat, `/bf toasts` still switches them off, and the matching art heads the same moment in the app. Original art from local ComfyUI; samples shown to Frank before the full set. **Built in 0.39** (samples approved: "Yes, this look"). | M–L | One look for everything the game shows you. |

## Tier 3 — Delight and depth

| # | Feature | Size | Where | Why it matters |
|---|---|---|---|---|
| 3.1 | *(Done: milestones and time per level on Characters → Journey since 0.28; past sessions and levels per day added in 0.48.)* **Session history and milestones.** Keep past sessions: levels per day, deaths, zones, time to each level. Celebrate milestones (first dungeon, level 10/20/30/40, mount, first flight path). | M | App | Progress you can see keeps people playing. |
| 3.2 | *(Done in 0.46: Adventure → Zones.)* **World tracker.** A 1–60 world view colored by zone level band, with per-zone progress rings ("Durotar 18/22 quests") and badges for completed zones. | M | App | A satisfying overview and a natural next-zone picker. |
| 3.3 | *(Done in 0.46: World Map ▶ replay and 🖼 picture of this session's path. Sessions are kept in memory only, so replay covers the current app session.)* **Journey replay and share card.** Replay a session's path on the map with level-up and death markers. Export a PNG of your own hand-drawn-style map. | M | App | Fun to share; no game art involved. |
| 3.4 | **Always-on-top mini Now.** *(Done in 0.44: Now → Mini Now. First part in 0.38: the answer panel over the game for A15.)* A small window beside the game showing your next step and pace, like the radar. | S–M | App | Live help without alt-tabbing. |
| 3.5 | *(Done in 0.45: Now → Speak steps.)* **Spoken next steps.** Optional local voice: "Hand in Call of Water to Islen Waterseer, south-east." Uses the existing local voice runtime. | M | App | Hands-free and accessible. |
| 3.6 | *(Done in 0.42 with A13.)* **Party sync.** Party members running the addon share which quest objectives they still need (addon messages). The app's Party page shows shared quests and who needs what. | L | Both | Grouping is easier when everyone sees the same plan. |
| 3.7 | *(Done in 0.43: Characters → All characters.)* **Alt dashboard.** Every character's rested XP, level, professions, gold and bag space at a glance, with "who to play tonight" suggestions. | M | App | For players with several characters. |

## Tier 4 — Exhaustive / long-term programs

| # | Program | Size | Notes |
|---|---|---|---|
| 4.1 | *(0.50: built for all eight races from the bundled data, as far as the data reaches (about level 42 for both factions; Dwarf and Gnome start at 10, Tauren skip 4–9). In game `/bf route guide`; in the app Adventure → Guided route with a coverage report. Frank chose "engine and review now" on 2026-11-15. 0.51: the hand review on Adventure → Guided route (keep, leave out, move; Export review → data/forever-route/reviews.json, built into the next release).)* **Full 1–60 guided route per race and faction.** A complete, curated, step-by-step leveling route, generated from our data and then hand-reviewed. It runs in the in-game step frame (2.3) with auto-advance, skip and "I'm behind or ahead" re-planning. **Partly done in 0.50 and 0.51:** routes for all eight races up to about level 42 and the review screen. **After 1.0:** routes to 60 after your review. | XL | The flagship. Needs 2.3 and 2.4 first. |
| 4.2 | *(Shipped in 0.34 as H4, the opt-in community at bf.backstagecoding.com.)* **Community data loop.** Opt-in, privacy-reviewed export of your own observations (positions of quest givers, objectives and trainers you met), to share with the community dataset. Closes Alliance gaps faster. | L | Must stay opt-in, contain no personal data, and be reviewed. |
| 4.3 | *(Accessibility done in 0.52: audit of every page and window, focus rings, reduced motion, high-contrast mode, keyboard World Map, quality in words, AA contrast. Translations: Frank chose framework plus German first, machine-translated with the local AI and marked as such, 2026-11-15. Done in 0.53: about 1,000 app texts and 150 addon messages in German; more languages follow the same way.)* **Accessibility and localization.** Screen-reader-friendly app and colorblind-safe icons. Localize the app and addon text (deDE, frFR, esES…) as data allows. | L | Data is enUS today. |
| 4.4 | *(Done in 0.47: planning tools plan_tonight, get_zone_progress, get_gear, get_dungeons, get_characters and get_session, plus an offline "what should I do tonight?" answer.)* **Smarter AI companion.** The companion gets tool access to everything above: routes, gear, dungeons and session history. It answers "what should I do tonight?" with a concrete plan. | L | Works with the user's own provider; no paid services by default. |
| 4.5 | **Graphics pass.** Original art for class portraits, page heroes, map pins, celebration effects and the in-game frames, kept consistent across the app. **Done in 0.21 onward (now tracked as Tier G).** | M–L per pass | See below. |
| 4.6 | **Other platforms.** macOS support (the live link is Windows-only today). *(Frank chose "Mac app, no live link", 2026-11-15.)* **Done in 0.55 (the Mac downloads first appear in 0.55.1):** a Mac app for Apple Silicon and Intel, ad-hoc signed (no Apple developer account), built by the release workflow on a GitHub Mac and added to each release. It finds WoW under Applications, installs the addon and reads your saves. Not on a Mac: the live link, the built-in free AI, voice, starting the game and automatic updates. | L | Only if wanted. |

---

## When to do a graphics pass

Frank offered ChatGPT/OpenAI, Grok and the local ComfyUI for art. Suggested timing:
1. **Done in 0.21:**
   - Painted heroes for Now and Help.
   - Level-up crest.
   - Commands crests.
   - Generated locally with ComfyUI (Qwen-Image 2.1, native 2K).
   - Next: World Map legend icons and class portraits.
2. **After 3.1/3.2:** milestone badges and zone badges, which are art-heavy by nature.
3. **Before 1.0:** a full visual review of every page against one style guide.

Rule: generated art must be original. No Blizzard assets, and nothing that imitates their art or logos.


## Tier H: owner direction (2026-11-14)

| # | Item | Size | Where | Why |
|---|---|---|---|---|
| H1 | **Every page earns its place.** Each page is audited: links go exactly where their label says, filler and repeated caveats give way to real game information, and every page uses the same banner, card, chip and map-button system as Now. A screen test fails if a page drifts. **Done in 0.31.** | L | App | Coherence is what makes the app feel premium. |
| H2 | **Quiet live strip.** The same screen-pixel link, made close to invisible: calibrated colour depth, a thin line, chosen placement, dimmed, idle when nothing changes. **Done in 0.32 (the hairline replaced it in 0.38).** | M | Both | The strip was getting big over the game. |
| H3 | **Live moments.** Feedback on live play beyond level-ups: deaths, profession ranks, boss/elite/rare kills, dungeon clears, chains, zones, flight paths, upgrades. **Done in 0.33.** | M–L | Both | Gives the app life next to the game. |
| H4 | **Community data.** A light self-hosted service shares anonymous locations and drops between players, and takes problem reports. **Done in 0.34.** | L | App + server | Accuracy grows with every player. |
| H5 | **Graphics first.** Every release audits its art: anything missing gets painted, anything out of place is replaced. **Done in 0.31 and 0.54 (ongoing).** | ongoing | App | The art is the draw. |
| H6 | **Top-addon features, built in.** Our own versions of the best addons' ideas where they help. **Done in 0.35 to 0.42 (the A rows).** | L | Both | One app for everything. |
| H7 | **Hidden live link.** *(Asked for by Frank, 2026-11-14. Built in 0.38, to be checked in the real client.)* The live strip becomes a one-pixel "hairline" along the top edge of the game in near-black shades, so it reads as a thin dark border: 892×1 physical pixels, 2-pixel cells, one bit per colour (0 or a dark 36 of 255), sync and off/on reference cells the app measures, and 165 bytes per frame (the live frame plus five pages, kinds 1–4 unchanged) behind a CRC-16 so a torn capture is refused whole. A first four-shade version failed in the real client (its gamma curve, saturation boost and colour bleed blur near-black shades), hence one bit a colour; `BF_LIVE_DUMP=<folder>` saves the top rows of an unreadable line for diagnosis. Pages go five at a time: a 200-character question needs 3 frames of 0.4 s (1.2 s a pass, three passes) and arrives in about 0.8–1.3 s instead of 6.8 s. The app reads the game window's own picture (Windows PrintWindow), so it keeps working when another window covers WoW, and falls back to a screen copy by itself. Minimized or closed WoW is "paused" with the last live state and its age, never "couldn't read", and resumes by itself. `/bf live safe` (sturdy corner strip for remote desktop; the app asks for it when it sees an unreadable line) and `/bf live compact` stay; `/bf live hairline` goes back; `/bf live pos` moves only the corner strips. | M | Both | The strip was too visible, and it stopped when another window or a minimized game hid it. |
| H8 | **The Adventure Compass at a glance.** *(Asked for by Frank, 2026-11-15: line the words up with the frame's art, and make the box useful as you play.)* The title sits centred under the compass crest and every line and button sits inside the painted brass border. The compact Compass (the - button) becomes a live summary: name, level and zone; an XP bar in a brass edge with rested XP in blue; your XP pace and time to the next level; quests in your log and how many are ready to hand in; and your next step (the guided route's step when you follow it, otherwise the Compass's own suggestion). German clients see it in German. **Built in 0.54.** | S–M | Addon | The box was mostly empty space; now a glance answers "how am I doing and what's next". |

## Tier J: after 1.0 (owner direction, 2026-11-17)

Frank asked for everything below, built one release at a time through the usual gates, plus anything else that clearly improves the app. Each phase ships as its own minor version; rows say "Done in 1.x" as they land. Rows carried over from the tiers above keep their old number in brackets.

### Phase 1.1: Badges you can look back on

| # | Item | Size | Where | Why |
|---|---|---|---|---|
| J1 | **Badges page.** **Done in 1.1.** *(Asked for by Frank, 2026-11-17: the new-badge banner shows once and there was no way to see them again.)* Characters → Badges: every badge per character with the date it was earned, filters (all, earned, still to earn), the latest five, the three closest to earning, a chip per character, who else on the account holds each badge, and account badges earned by all your characters together. The new-badge banner opens it on that badge. | M | App | What you have earned should stay visible. |
| J2 | **More badges.** **Done in 1.1.** Professions (skill 75, 150, 225, 300), gold carried (10, 100, 1000), reputation (Honored, Revered, Exalted), and account badges (2, 5 and 10 characters; Horde and Alliance both). Painted locally like the rest. | S–M | App | Milestones beyond levels and quests. |
| J3 | **Badges in game.** **Done in 1.2.** `/bf badges` lists what this character has earned and what's next; a small banner in game when one is earned on a save. | S | Addon | Same rewards without alt-tabbing. |

### Phase 1.2: Finish what's half-built

| # | Item | Size | Where | Why |
|---|---|---|---|---|
| J4 | **Gathering spots on the in-game map** [A6], plus a route through them for your skill level. **Done in 1.2:** a Gathering spots layer on the World Map, greyed above your skill; `/bf nodes` arrows the nearest node you can gather. | M | Addon | The app remembers 500 spots; the map in game should show them. |
| J5 | **Price memory, part 2** [A7]: vendor prices in tooltips, and bags flag what's worth selling. **Done in 1.2:** auction and vendor price on item tooltips, green when auction pays more, and `/bf sell` for your bags. | M | Both | Gold for training and the mount. |
| J6 | **Gear-set button in game** [A12]. **Done in 1.2:** a Gear sets button beside the character window. | S | Addon | No typing `/bf set wear`. |
| J7 | **One tooltip everywhere** [A14]: what an item is for, where it drops, its price and whether it's an upgrade, the same in game and in the app. **Done in 1.2 in game:** quest use, price and upgrade lines on one tooltip; drop sources stay in the app's hover cards (the addon carries no loot tables). | M | Both | One answer, everywhere. |
| J8 | **Quest icons over enemies** [A1]. **Done in 1.2:** a ! over nameplates of enemies a quest still needs (`/bf plates`). | M | Addon | See at a glance what you still need. |

### Phase 1.3: Deeper guidance

| # | Item | Size | Where | Why |
|---|---|---|---|---|
| J9 | **Class quests and key unlocks** [E5], from hand-written lists per class, community data filling the gaps. **Done in 1.3:** hand-written unlocks for all nine classes on Characters → Talents. | L | App | Easy to miss, hard to piece together. |
| J10 | **Trainer planner, part 2** [E3]: what the next visits cost and whether you can afford them. **Done in 1.3:** prices from the trainer window you open; Now says what the next visits cost and what you're short. | M | App | No surprise empty purse at the trainer. |
| J11 | **Riding and mount savings goal** [E4], with costs from saves or community data. **Done in 1.3:** riding trainer and mount vendor prices you saw add up to a one-click goal. | M | App | The biggest money goal in leveling. |
| J12 | **Reputation advice** [E6]: fastest turn-ins and what each level unlocks. **Done in 1.3:** Fastest ways up on Ledger → Reputation. | M | App | Rep is slow without a plan. |
| J13 | **Boss tips** [A5]: short plain tips when you target a dungeon boss, and a pull checklist. Text only. **Done in 1.3:** tips for the leveling dungeons (and Onyxia, Ragnaros) on the atlas and in game; the pull checklist is the atlas's existing preparation list. | M | Both | New players wipe less. |

### Phase 1.4: Companion and the route

| # | Item | Size | Where | Why |
|---|---|---|---|---|
| J14 | **Guided route past level 42** for both factions, and the Dwarf, Gnome and Tauren early gaps [4.1]. **Partly done in 1.4:** the bundled data has almost no quest-giver positions above 40, so the addon now learns each giver when you accept its quest and the app's route grows from that. The in-game route (built into the addon) still stops at 42; next: carry learned givers into community data. | L | Both | The route should reach 60. |
| J15 | **Smarter Companion**: more benchmark questions (gathering, class quests, reputation), an opt-in web lookup through your own AI provider with sources, a live-model voice check. **Partly done in 1.4:** class unlocks, boss tips and reputation answered locally, with nine new benchmark questions. Still to do: the opt-in web lookup and a live-model voice check. | M | App | Better answers. |
| J16 | **Plan my evening.** Tell it how long you have; it lays out quests, training and selling that fit. **Done in 1.4.** | M | App | A plan sized to tonight. |
| J17 | **Weekly recap.** Each week: levels, badges, gold, best split and deaths, per character, on Now and Journey. **Done in 1.4.** | S–M | App | A reason to come back and a sense of progress. |
| J18 | **Rested and alt reminders.** "Beta is fully rested", "Alpha's cooldown is ready", on All characters and Now. **Done in 1.4:** on Now (rested, cooldowns, mail, gold goal). | S | App | Play the right character tonight. |

### Phase 1.5: Graphics, part 2

| # | Item | Size | Where | Why |
|---|---|---|---|---|
| J19 | **Flowing routes** [G4]: lines that flow toward the next step, footprints and a pulsing target. **Done in 1.5.** | M | App | The map feels alive. |
| J20 | **Boss silhouettes and loot trays** [G6]. **Done in 1.5:** a painted final-boss silhouette for each dungeon and raid on the Instance Atlas, and loot on velvet trays. | M | App | Dungeons look as good as they read. |
| J21 | **Celebrations, part 2** [G8]: new mount and finished zone, and painted class crests everywhere. **Done in 1.5:** a big moment for your own mount, levels 40 and 60 and the other top badges; a finished zone is celebrated once; class crests on Ledger rows too. | M | App | Big moments feel big. |

### Longer term

| # | Item | Size | Where | Why |
|---|---|---|---|---|
| J22 | **Live link on the Mac.** Opt-in Screen Recording permission the player grants, clearly explained; the decoder is shared with Windows. **Waiting on the owner:** it needs a small Mac capture helper (the window picture, the same hairline decoder) and can only be tested once Screen Recording is allowed for the app on the test Mac, a privacy setting only the owner should change. | L | App | Mac players get pace, deaths and time to level. |
| J23 | **Party sync with two real players** and **German in a German client**, tested. **Needs people:** two players in a party, and a German game client. | S | Both | Built but not checked in the real game. |
| J24 | **Publish to the addon sites with each release**, once the owner sets up the three projects. **Built (Addon sites workflow); waiting on the owner's projects and tokens.** | S | CI | One release, every site. |
| J25 | **Backup and move your journal**: one file to export and import on another PC. **Already in the app:** Settings → Export and Import (with a recovery point before every import). | S | App | Nothing lost on a new computer. |

### Ideas added while building (2026-11-17)

| # | Item | Size | Where | Why |
|---|---|---|---|---|
| J26 | **Share learned quest givers** through the opt-in community data, and carry them into the in-game route the addon builds. **Needs a community server update** (a new kind of shared fact), which is the owner's to deploy. | M | Both | One player's play fills the route for everyone, in the game too. |
| J27 | **Badge case picture.** A painted PNG of a character's badges to save or share, like the journey picture. **Done in 1.6.** | S | App | Something to show off. |
| J28 | **Badges in the Compass.** The in-game Adventure Compass shows the next badge and its progress. **Done in 1.5.** | S | Addon | Goals in view while you play. |
| J29 | **Reminders in game.** At login: another character's rested XP is full, a cooldown is ready, mail is expiring. **Done in 1.5.** | S | Addon | Same reminders without opening the app. |
| J30 | **Profession shopping list.** What to buy or gather for your next skill-ups, minus what is already in bags, bank and mail across your characters. **Done in 1.6:** each row says where you already stored it and how many are still to get. | M | App | Skill-ups without guesswork. |
| J31 | **Boss tips for the remaining raid bosses**, reviewed before they ship. **Molten Core:** nine [reviewed Classic reference tips](raid-boss-tip-review.md) plus the unchanged Ragnaros tip; the additional client encounter has no verified target or tip. **Blackwing Lair:** [eight reviewed Classic reference tips](blackwing-lair-tip-review.md). **Zul'Gurub:** thirteen reviewed Classic reference tips across the [opening](zulgurub-tip-review.md), [second](zulgurub-next-tip-review.md), and [final](zulgurub-final-tip-review.md) batches. The final batch includes Hakkar, Gahz'ranka, and four individually matched Edge of Madness rotation bosses. These reviews do not validate live Forever behavior. Other raids remain open. | M | Both | Raids deserve the same help as dungeons. |

## Suggested release sequence

- **0.21 (shipped):** repair, flight paths, version check, Alliance vendors, flaky checks, art pass 1.
- **0.22 (shipped):**
  - D1 dialed-in Show on map, D2 link audit (Now).
  - D4 community quest fields.
  - D3 rich quest pages, first pass.
  - Art pass 2: step crests and zone vistas.
  - Still to do: class crests, and auditing links outside Now.
- **0.23 (shipped):**
  - D5 local item, spell and talent details.
  - D3 rewards with stats and icons.
  - D6 data coverage.
  - 2.1 reward picker, 2.2 upgrade tooltips, 2.6 talent coach.
  - 2.9 hearth advice, 1.3 no-XP quest hints, 1.5 helper switches, class crests.
  - Moved to 0.24: D7 card system, gear review with icons on Characters, 1.9 remote live-link check.
- **0.24 (shipped):** Quest intel Q1–Q6, 2.4 objective areas, 2.5 enemy levels, 2.7 dungeon readiness, gear review with icons. D7 card system moves to 0.25.
- **0.25 (shipped):** N1–N3 Now fixes, R1–R3 always current without /reload (live quest log pages), F1 quick answers with no AI, E10 one-click setup (first part: Set it all up on Now). 2.3 route stepper moves to 0.26.
- **0.26 (shipped):** 2.3/A2 route stepper (`/bf route`, step frame, arrow), A1 objective progress in enemy tooltips (overhead icons come later), E1 zone briefing, G2 zone arrival banners, G3 painted map pins and city banners.
- **0.27 (shipped):** F2 one-click free AI (llama.cpp engine and Qwen models, pinned and checked), F3 free cloud keys (Gemini, Groq), E3 trainer planner with spell icons, E2/A9 supplies and class helpers, G1 living headers.
- **0.28 (shipped):** A3 speed splits, E9 rested planner, G7 badge wall with new-badge moments, and the addon journal (levels with /played, firsts, zones). Professions and the card system move to 0.29.
- **0.29 (shipped):** A14 hover cards for quests, E7 death review, A8 session stats (`/bf stats`).
- **0.30 (shipped):** 2.8 + E8 professions (skill-up colours, best next recipe, countdown, shopping list, `/bf prof`), A6 gathering memory (500 nodes, chests, heat map, `/bf nodes`), hover cards for NPCs and items (D7/E11), A4 dungeon loot browser with wish list.
- **0.31 (shipped):** H1 page-by-page quality pass (every link lands on what it says, filler replaced by real information, Adventure rebuilt in the Now style, one design system on every page), H5 art audit (a painted banner per page, one set of class art, a real Companion crest, no reused or out-of-place art), test stability.
- **0.32 (tagged; shipped inside 0.33):** H2 quiet live strip: calibrated colour depth (many shades per pixel on your own PC, sturdy 2-shade mode over remote sessions), a thin line about 300×4 pixels instead of 640×28, your choice of screen edge or corner, dimmed, and blank while nothing changes.
- **0.33 (shipped):** H3 live moments: an app death screen (what killed you, the damage breakdown, a tip), profession rank-ups and trainer reminders, boss, elite and rare kills, dungeon cleared, quest chain finished, new zone, flight path learned, upgrade equipped. Painted art for each; in-game toasts optional and quiet in combat.
- **0.34 (shipped):** H4 community at bf.backstagecoding.com (on by default, easy off switch): anonymous, rounded locations of herbs, ore, chests, NPCs and vendors, boss drops and recipe sources; published only when several installs agree; one daily download, offline as before. "Report a problem" with a preview of exactly what is sent. Self-hosted on Frank's server, no paid services.
- **0.35 (shipped):** H6 all-in-one, first part, "the ledger": inventory across all characters (bags, bank and mail as last seen, searchable) **done**; A7 price memory from Auction House pages you open yourself (`/bf prices`, remembered prices on Gold & prices and on item cards) **done**; E6 reputation bars per character, Alliance and Horde alike **done**; profession cooldowns (transmutes, Mooncloth, Salt Shaker) **done**; gold per character and `/bf ledger` **done**. Moved to 0.36: E4 mount and gold goals, E5 class quest chains, A12 gear sets, G5 character sheet.
- **0.36 (shipped):** "Your character": G5 character sheet, first part (Characters → Sheet: paper doll with quality colours, average item level, empty slots, pieces to replace, upgrades already in bags or bank, base stats, armor, attack power and resistances from the addon) **done**; A12 gear sets (`/bf set save|wear|list|delete`, worn from bags only and never in combat, sets with scores and where each piece is on the Sheet) **done**; E4 gold goal (your own target on Gold & prices, progress across characters, days left from a daily gold log) **done**. Moved later: suggested riding and mount costs (needs trainer and mount price data we do not bundle), E5 class quest chains (needs class-restricted quest data), G5 painted portraits and talent tree view, an in-game gear set button.
- **0.37 (shipped):** G13 painted in-game zone banners **done**: a solid painted banner (560×74) for each of the 46 zones and capitals, with the zone name in gold and the level range and quests for your level on a dark ribbon; zones without a painting use a default one; the same painting heads the zone card, the Where to level list and the saved-location card in the app.
- **0.38 (shipped):** A15 ask the companion from inside the game (minimap button, question over the live strip, answer in an always-on-top panel; builds 3.4 mini window first) **done** (questions checked arriving from the real client; the answer panel checked by smoke); H7 hidden live link (one-pixel hairline along the top edge as the default, one bit a colour, five pages a frame so questions arrive in about a second, read from the game window even when it is covered, "paused" while WoW is minimized; `/bf live safe|compact` kept) **done** (checked on Frank's real client: the first four-shade line failed under WoW's colour boost, the shipped one-bit line reads cleanly, live while covered).
- **0.39 (shipped):** G14 painted in-game message banners **done**: 14 original paintings, one per kind of message (flight master, quest complete, level up, you died, run back, back on your feet, gear, Hearthstone, ready, supplies, journey firsts, fight review, elite/rare/boss kills, profession milestones), solid with a gold frame, the title in gold and the text on a ribbon that hugs it; long text makes the box taller and the painting is cropped, never stretched.
- **0.39.1 (shipped):** A15 one window: the owl opens the companion panel over the game ready to type; ask, read the answer and follow up in the same window; Esc closes it. The in-game question box is gone.
- **0.40 (shipped):** A10 enemy player alerts: "Alliance level 32 Rogue nearby" from your target, mouseover and nameplates, a `/bf enemy` history, never in battlegrounds.
- **0.41 (shipped):** A11 quality of life pack: `/bf qol coords|loot|dismount|questtext`, each off until switched on.
- **0.42 (shipped):** A13/3.6 party sync: quest progress swapped with party members who run the addon, `/bf party` who needs what, shared waypoints.
- **0.43 (shipped):** 3.7 alt dashboard: Characters → All characters with level, XP, rested XP grown since logout, gold, bags and professions for everyone, and who to play tonight.
- **0.44 (shipped):** 3.4 mini Now: a small always-on-top window with your next step and its direction, XP and rested bar, and this session's pace.
- **0.45 (shipped):** 3.5 spoken steps: Now → Speak steps reads each new next step aloud with the local Windows voice.
- **0.46 (shipped):** 3.2 world tracker (Adventure → Zones: every zone for your faction with quests done and finished-zone stars) and 3.3 journey replay and share picture on the World Map.
- **0.47 (shipped):** 4.4 smarter companion: "what should I do tonight?" gets an ordered plan from the next step, rested XP, zones, dungeons, gear and your other characters, with or without an AI model.
- **0.48 (shipped):** 3.1 past sessions: Characters → Journey keeps each play session and charts levels per day. Tier 3 is complete.
- **0.49 (shipped):** G9 painted Compass and step frames in game, G10 welcome splash and tour, G11 Horde and Alliance themes.
- **0.50 (shipped):** 4.1 guided route, part 1: a step-by-step route per race from level 1, in game with `/bf route guide` (auto-advance, skip, ahead and behind) and on Adventure → Guided route with a coverage report.
- **0.51 (shipped):** 4.1 part 2: the hand review. Keep, leave out or move any step of any race's route on Adventure → Guided route; Export review for the next release.
- **0.52 (shipped):** 4.3 part 1, accessibility.
- **0.53 (shipped):** 4.3 part 2: translations. The app and the addon follow the game's language; German first, machine-translated with the local model and marked.
- **0.54 (shipped):** G12 art review and H8, the Adventure Compass at a glance.
- **0.55 (shipped):** 4.6 the Mac app (no live link).
- **0.56 (shipped):** public readiness: a front page with a screenshot, plain-language privacy, a security policy, contributing guide, code of conduct and issue templates, a rewritten Getting started and compatibility at a glance.
- **0.57 (shipped):** hardening for 1.0: every row above marked done, partly done or after 1.0; the rest of the app's German (sentences with numbers and names); stable installs skip pre-releases.
- **0.58:** the companion understands what you ask (a 100-question benchmark, 15% → 97% covered, answers from Forever's own data, roleplay voice grounded in verified facts, more refusals); portraits matched on race, sex and class (Rolica is a female Forsaken priest); a painting for every dungeon and raid; credits for Frank Arena and Jason Babiuch with the Backstage Coding website.
- **After 0.58, before and after 1.0:** the companion keeps improving against the benchmark: more questions (gathering spots, class quests, reputation), a live-model voice check, and the opt-in web lookup.
- **0.59 (shipped):** the companion understood 100% of a held-out question set (56.7% before); the addon zip with every release and packaging for CurseForge, Wago and WoWInterface.
- **1.0 release candidate (done):** Frank's hands-on check with [the acceptance checklist](ACCEPTANCE-1.0.md), then fixes.
- **1.0 (shipped 2026-11-16):** after Frank's hands-on acceptance. Known limits, listed rather than required: party sync with a second player, and the German messages in a German game client.
- **1.0.1 (2026-11-16):** the Mac app tested on a real Mac (Apple silicon, macOS 27, WoW Forever installed): finds the game, installs the addon, reads map art. Fixed: Mac update notices (check-only, signed feed), a Mac first-run checklist that finishes, macOS 15 first-open steps; companion picks the side and starting point from the race or city a question names, zeppelin direction, nearest drops first. Still open: live link on Mac.
- **1.0.2 (2026-11-16):** `SHA256SUMS.txt` written with LF so `shasum -c` works on a Mac (the Windows job wrote CRLF). Verified on the real Mac: the published 1.0.1 download checks, opens and shows its version; the addon saves character, quests, stats and ledger in a Mac game session.
- **After 1.0:** the rows marked "After 1.0" above, and the route review (Frank goes through the routes) whenever it suits.

Keep this file and Help → Commands updated with each release.
- **1.1.0 (2026-11-17):** J1 Badges page (Characters → Badges: every badge per character with its date, filters, latest, closest next, who else holds it, account badges; the new-badge banner opens it) and J2 more badges (professions, gold, reputation, account). Next: the rest of Tier J, phase by phase.
- **1.2.0 (2026-11-17):** J3 badges in game; phase 1.2: J4 gathering spots on the World Map, J5 price lines and `/bf sell`, J6 Gear sets button, J7 quest use on item tooltips, J8 quest icons over enemies. Reputation badges read the saved ledger shape.
- **1.3.0 (2026-11-17):** phase 1.3: J9 class unlocks, J10 training costs, J11 riding-and-mount goal, J12 reputation advice, J13 boss tips.
- **1.4.0 (2026-11-17):** phase 1.4: J14 routes learn quest givers from play, J15 local answers for unlocks/boss tips/reputation, J16 plan by time, J17 weekly recap, J18 reminders.
- **1.5.0 (2026-11-17):** phase 1.5: J19 flowing routes and footprints, J20 final-boss paintings and velvet loot trays, J21 big moments and finished zones. J25 found already built. Added J26-J31; J28 (next badge in the Compass) and J29 (reminders in game) done too.
- **1.6.0 (2026-11-17):** J27 badge case picture, J30 shopping list knows your stored materials.
